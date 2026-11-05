import type {
	AbstractServiceOptions,
	Item,
	MutationOptions,
	PrimaryKey,
	UpdateGroup,
} from '@directus/types';
import { InvalidPayloadError } from '@directus/errors';
import { UserIntegrityCheckFlag } from '@directus/types';
import {
	validateAccess,
	type ValidateAccessOptions,
} from '../permissions/modules/validate-access/validate-access.js';
import { clearCachesAfterCommit } from '../utils/clear-caches-after-commit.js';
import { validateKeys } from '../utils/validate-keys.js';
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

function includesAccessKey(keys: PrimaryKey[], accessId: string): boolean {
	// A uuid key matches its row whatever its case.
	return keys.some((key) => {
		return String(key).toLowerCase() === accessId.toLowerCase();
	});
}

function lowerCaseKey(relatedKey: unknown): unknown {
	return typeof relatedKey === 'string'
		? relatedKey.toLowerCase()
		: relatedKey;
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
	 */
	private refuseManagedByInRequest(data: Partial<Item>[]) {
		if (this.accountability && data.some((item) => 'managed_by' in item)) {
			throw new InvalidPayloadError({
				reason: '"managed_by" is set by the extension granting the access,'
					+ ' not by a request',
			});
		}
	}

	// Read outside the write's transaction: an extension marking a row between
	// this read and the write is not seen, and the request's write lands.
	private async readManagedAccessInRequest(
		keys: PrimaryKey[],
	): Promise<ManagedAccessRow[]> {
		if (!this.accountability) {
			return [];
		}

		// Before the read, whose uuid cast would fail in the database instead.
		validateKeys(
			this.schema,
			this.collection,
			this.schema.collections[this.collection]!.primary,
			keys,
		);

		return await this.knex
			.select('id', 'managed_by', ...MANAGED_ACCESS_GRANT_FIELDS)
			.from('directus_access')
			.whereIn('id', keys)
			.whereNotNull('managed_by');
	}

	// The base class checks access after this guard: a caller with none gets its
	// 403 here, as the refusal would name the row and the extension managing it.
	private async refuseManagedAccessChange(
		managedAccess: ManagedAccessRow,
		accessCheck: Pick<ValidateAccessOptions, 'action' | 'fields'>,
	): Promise<never> {
		await validateAccess(
			{
				accountability: this.accountability!,
				collection: this.collection,
				primaryKeys: [managedAccess.id],
				...accessCheck,
			},
			{ knex: this.knex, schema: this.schema },
		);

		throw new ManagedAccessChangeError(managedAccess);
	}

	private async refuseManagedAccessDelete(keys: PrimaryKey[]) {
		const [managedAccess] = await this.readManagedAccessInRequest(keys);

		if (managedAccess) {
			await this.refuseManagedAccessChange(managedAccess, { action: 'delete' });
		}
	}

	/** Who gets which policy is the extension's; `sort` and the rest are not. */
	private async refuseManagedGrantChange(groups: UpdateGroup<Item>[]) {
		const managedRows = await this.readManagedAccessInRequest(
			groups.flatMap((group) => group.keys),
		);

		for (const managedAccess of managedRows) {
			const refusedGroup = groups.find((group) => {
				return includesAccessKey(group.keys, managedAccess.id)
					&& changesGrantField(group.data, managedAccess);
			});

			if (refusedGroup) {
				await this.refuseManagedAccessChange(managedAccess, {
					action: 'update',
					fields: Object.keys(refusedGroup.data),
				});
			}
		}
	}

	override async createMany(
		data: Partial<Item>[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		this.refuseManagedByInRequest(data);

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
		this.refuseManagedByInRequest(groups.map((group) => group.data));
		await this.refuseManagedGrantChange(groups);

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
		await this.refuseManagedAccessDelete(keys);

		return await this.deleteAccessRows(keys, opts);
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
			? await this.deleteAccessRows(accessKeys, { ...opts, keysFromQuery: true })
			: [];
	}

	private async deleteAccessRows(
		keys: PrimaryKey[],
		opts: MutationOptions,
	): Promise<PrimaryKey[]> {
		// Changes here can affect the number of admin/app/api users
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		const result = await super.deleteMany(keys, opts);

		// Some policy attachments have been deleted, clear the caches
		await this.clearCaches();

		return result;
	}
}
