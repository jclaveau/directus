import type {
	AbstractServiceOptions,
	Item,
	MutationOptions,
	PrimaryKey,
	UpdateGroup,
} from '@directus/types';
import { InvalidPayloadError } from '@directus/errors';
import { UserIntegrityCheckFlag } from '@directus/types';
import type { Knex } from 'knex';
import { clearCachesAfterCommit } from '../utils/clear-caches-after-commit.js';
import { ItemsService } from './items.js';

const MANAGED_ACCESS_GRANT_FIELDS = ['role', 'user', 'policy'] as const;

type ManagedAccessRow = {
	id: string;
	managed_by: string;
	role: string | null;
	user: string | null;
	policy: string;
};

class ManagedAccessChangeError extends InvalidPayloadError {
	constructor({ id, managed_by }: ManagedAccessRow) {
		super({
			reason: `Access ${JSON.stringify(id)} is managed by`
				+ ` ${JSON.stringify(managed_by)}, which alone changes it`,
		});
	}
}

class ManagedBySetError extends InvalidPayloadError {
	constructor() {
		super({
			reason: '"managed_by" is set by the extension granting the access,'
				+ ' not by a request',
		});
	}
}

// A uuid key matches its row whatever its case.
function lowerCaseAccessKey(accessKey: PrimaryKey): string {
	return String(accessKey).toLowerCase();
}

function groupDataByKey(
	groups: UpdateGroup<Item>[],
): Map<string, Partial<Item>[]> {
	const dataByKey = new Map<string, Partial<Item>[]>();

	for (const { keys, data } of groups) {
		for (const key of keys) {
			const accessKey = lowerCaseAccessKey(key);
			const keyData = dataByKey.get(accessKey);

			if (keyData) {
				keyData.push(data);
			}
			else {
				dataByKey.set(accessKey, [data]);
			}
		}
	}

	return dataByKey;
}

function lowerCaseKey(relatedKey: unknown): unknown {
	return typeof relatedKey === 'string'
		? relatedKey.toLowerCase()
		: relatedKey;
}

function setsManagedBy(item: Partial<Item>): boolean {
	return 'managed_by' in item && item['managed_by'] !== null;
}

function changesManagedBy(
	data: Partial<Item>,
	managedAccess: ManagedAccessRow,
): boolean {
	return 'managed_by' in data && data['managed_by'] !== managedAccess.managed_by;
}

/** A relation may come as its key, or as an object holding it: `{ id, ... }`. */
function changesGrantField(
	data: Partial<Item>,
	managedAccess: ManagedAccessRow,
): boolean {
	return MANAGED_ACCESS_GRANT_FIELDS.some((grantField) => {
		if (!(grantField in data)) {
			return false;
		}

		const fieldValue = data[grantField];

		const isRelatedObject = typeof fieldValue === 'object' && fieldValue !== null;

		// `{ id: null }` finds no row, so the payload creates the related item.
		if (isRelatedObject && fieldValue.id === null) {
			return true;
		}

		const relatedKey = isRelatedObject
			? fieldValue.id
			: fieldValue;

		return lowerCaseKey(relatedKey) !== lowerCaseKey(managedAccess[grantField]);
	});
}

export class AccessService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_access', options);
	}

	private async clearCaches(opts?: MutationOptions) {
		await clearCachesAfterCommit(this.knex, this.cache, opts);
	}

	/**
	 * An access row with `managed_by` is granted by that extension, whose code
	 * runs without accountability: a request changing it by hand would be undone
	 * by the extension, or strand the subscription it tracks.
	 *
	 * Judged like the write's other checks, after the filter hooks, the 403s and
	 * the permission presets: a side effect of a refused request belongs in an
	 * action hook, which it never reaches.
	 */
	protected override async validateRowsToCreate(
		rows: Partial<Item>[],
	): Promise<void> {
		if (this.accountability && rows.some((row) => setsManagedBy(row))) {
			throw new ManagedBySetError();
		}
	}

	// No row is locked: an extension marking a row between this read and the
	// write is not seen, and the request's write lands.
	private async readManagedAccess(
		keys: PrimaryKey[],
		trx: Knex,
	): Promise<ManagedAccessRow[]> {
		return await trx
			.select('id', 'managed_by', ...MANAGED_ACCESS_GRANT_FIELDS)
			.from('directus_access')
			.whereIn('id', keys)
			.whereNotNull('managed_by');
	}

	protected override async validateKeysToDelete(
		keys: PrimaryKey[],
		opts: MutationOptions,
		trx: Knex,
	): Promise<void> {
		if (!this.accountability || opts.deletesManagedAccess) {
			return;
		}

		const [managedAccess] = await this.readManagedAccess(keys, trx);

		if (managedAccess) {
			throw new ManagedAccessChangeError(managedAccess);
		}
	}

	/**
	 * Who gets which policy is the extension's; `sort` and the rest are not. A
	 * value sent back as it is stored changes nothing, so it is no refusal.
	 */
	protected override async validateGroupsToUpdate(
		groups: UpdateGroup<Item>[],
		trx: Knex,
	): Promise<void> {
		if (!this.accountability) {
			return;
		}

		const managedRows = await this.readManagedAccess(
			groups.flatMap((group) => group.keys),
			trx,
		);

		const dataByKey = groupDataByKey(groups);

		for (const managedAccess of managedRows) {
			const keyData = dataByKey.get(lowerCaseAccessKey(managedAccess.id)) ?? [];

			const isRefused = keyData.some((data) => {
				return changesManagedBy(data, managedAccess)
					|| changesGrantField(data, managedAccess);
			});

			if (isRefused) {
				throw new ManagedAccessChangeError(managedAccess);
			}
		}

		const managedKeys = new Set(
			managedRows.map(({ id }) => lowerCaseAccessKey(id)),
		);

		for (const group of groups.filter(({ data }) => setsManagedBy(data))) {
			const hasUnmanagedKey = group.keys.some((key) => {
				return !managedKeys.has(lowerCaseAccessKey(key));
			});

			if (hasUnmanagedKey) {
				throw new ManagedBySetError();
			}
		}
	}

	override async createMany(
		data: Partial<Item>[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		// Creating a new policy attachments affects the number of admin/app/api users.
		// But it can only add app or admin users, so no need to check the remaining admin users.
		opts.userIntegrityCheckFlags =
			(opts.userIntegrityCheckFlags ?? UserIntegrityCheckFlag.None) | UserIntegrityCheckFlag.UserLimits;

		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		const result = await super.createMany(data, opts);

		// A new policy has been attached to a user or a role, clear the caches
		await this.clearCaches();

		return result;
	}

	override async updateGroups(
		groups: UpdateGroup<Item>[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		// Updating policy attachments might affect the number of admin/app/api users
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		const result = await super.updateGroups(groups, {
			...opts,
			userIntegrityCheckFlags: UserIntegrityCheckFlag.All,
		});

		// Some policy attachments have been updated, clear the caches
		await this.clearCaches();

		return result;
	}

	override async deleteMany(keys: PrimaryKey[], opts: MutationOptions = {}): Promise<PrimaryKey[]> {
		// Changes here can affect the number of admin/app/api users
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		const result = await super.deleteMany(keys, opts);

		// Some policy attachments have been deleted, clear the caches
		await this.clearCaches();

		return result;
	}

	/**
	 * What a role delete takes along, managed rows included: the database's
	 * cascade does the same for a deleted user or policy.
	 */
	async deleteRoleAccess(
		roleKeys: PrimaryKey[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		const accessKeys = await this.getKeysByQuery({
			filter: { role: { _in: roleKeys } },
		});

		return accessKeys.length > 0
			? await this.deleteMany(accessKeys, {
				...opts,
				deletesManagedAccess: true,
				keysFromQuery: true,
			})
			: [];
	}
}
