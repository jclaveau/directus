import { InvalidPayloadError } from '@directus/errors';
import {
	type AbstractServiceOptions,
	type Item,
	type MutationOptions,
	type PrimaryKey,
	type UpdateGroup,
	UserIntegrityCheckFlag,
} from '@directus/types';
import type { Knex } from 'knex';
import {
	announceMembershipsChangedAfterCommit,
	clearPermissionsCacheAfterCommit,
	flushResponseCacheAfterCommit,
} from '../utils/clear-caches-after-commit.js';
import {
	changesGrantField,
	changesManagedBy,
	groupDataByKey,
	lowerCaseRowKey,
	setsManagedBy,
} from '../utils/managed-rows.js';
import { ItemsService } from './items.js';

const MEMBERSHIP_GRANT_FIELDS = ['user', 'role'] as const;

type ManagedMembershipRow = {
	id: string;
	managed_by: string;
	user: string;
	role: string;
};

// Each manager says what changes its membership.
function managedMembershipReason({
	id,
	managed_by,
	user,
	role,
}: ManagedMembershipRow): string {
	if (managed_by === 'invite') {
		return `Membership ${JSON.stringify(id)} comes from the invites of user`
			+ ` ${JSON.stringify(user)} to role ${JSON.stringify(role)}: delete`
			+ ' those invites to remove it';
	}

	if (managed_by.startsWith('auth:')) {
		return `Membership ${JSON.stringify(id)} is managed by`
			+ ` ${JSON.stringify(managed_by)}: the next login of user`
			+ ` ${JSON.stringify(user)} sets it from that provider's ROLE_MAPPING`;
	}

	return `Membership ${JSON.stringify(id)} is managed by`
		+ ` ${JSON.stringify(managed_by)}, which alone changes it`;
}

class ManagedMembershipChangeError extends InvalidPayloadError {
	constructor(managedMembership: ManagedMembershipRow) {
		super({ reason: managedMembershipReason(managedMembership) });
	}
}

class MembershipManagedBySetError extends InvalidPayloadError {
	constructor() {
		super({
			reason: '"managed_by" is set by the code managing the membership,'
				+ ' not by a request',
		});
	}
}

/**
 * A membership gives a user a role (#746). Its writes change what the user
 * may do, so each clears the permissions and response caches (not the
 * schema: #754 parks clearing one user's only), and each but a create may
 * leave the instance with no admin.
 *
 * `managed_by` names the code owning a membership, which writes it without
 * accountability: null for one given by hand, `invite` while an invite of a
 * user not yet active holds it, `auth:<provider>` for one an SSO login's
 * ROLE_MAPPING sets, and `ext:<extension name>` by convention for one an
 * extension writes (no check enforces that prefix). A request neither sets
 * `managed_by` nor changes or deletes a managed membership; `sort` stays its.
 */
export class RoleMembersService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_role_members', options);
	}

	// A membership changes no schema: the permissions cache, whose own clear
	// reaches the other nodes, the response cache, and the roles of the sockets
	// its users hold open are all it leaves stale.
	private async clearCaches(
		memberUsers: readonly string[],
		opts?: MutationOptions,
	) {
		await clearPermissionsCacheAfterCommit(this.knex);
		await flushResponseCacheAfterCommit(this.knex, this.cache, opts);
		await announceMembershipsChangedAfterCommit(this.knex, memberUsers);
	}

	private async readMemberUsers(keys: PrimaryKey[]): Promise<string[]> {
		if (keys.length === 0) {
			return [];
		}

		const memberships: { user: string }[] = await this.knex
			.select('user')
			.from('directus_role_members')
			.whereIn('id', keys);

		return memberships.map(({ user }) => user);
	}

	protected override async validateRowsToCreate(
		rows: Partial<Item>[],
	): Promise<void> {
		if (this.accountability && rows.some((row) => setsManagedBy(row))) {
			throw new MembershipManagedBySetError();
		}
	}

	// No row is locked: code marking a row between this read and the write is
	// not seen, and the request's write lands.
	private async readManagedMemberships(
		keys: PrimaryKey[],
		trx: Knex,
	): Promise<ManagedMembershipRow[]> {
		return await trx
			.select('id', 'managed_by', ...MEMBERSHIP_GRANT_FIELDS)
			.from('directus_role_members')
			.whereIn('id', keys)
			.whereNotNull('managed_by');
	}

	protected override async validateKeysToDelete(
		keys: PrimaryKey[],
		opts: MutationOptions,
		trx: Knex,
	): Promise<void> {
		if (!this.accountability || opts.deletesManagedMemberships) {
			return;
		}

		const [managedMembership] = await this.readManagedMemberships(keys, trx);

		if (managedMembership) {
			throw new ManagedMembershipChangeError(managedMembership);
		}
	}

	/**
	 * Who holds which role is the manager's; `sort` is not. A value sent back
	 * as it is stored changes nothing, so it is no refusal.
	 */
	protected override async validateGroupsToUpdate(
		groups: UpdateGroup<Item>[],
		trx: Knex,
	): Promise<void> {
		if (!this.accountability) {
			return;
		}

		const managedRows = await this.readManagedMemberships(
			groups.flatMap((group) => group.keys),
			trx,
		);

		const dataByKey = groupDataByKey(groups);

		for (const managedMembership of managedRows) {
			const keyData = dataByKey.get(lowerCaseRowKey(managedMembership.id))
				?? [];

			const isRefused = keyData.some((data) => {
				return changesManagedBy(data, managedMembership)
					|| changesGrantField(
						data,
						managedMembership,
						MEMBERSHIP_GRANT_FIELDS,
					);
			});

			if (isRefused) {
				throw new ManagedMembershipChangeError(managedMembership);
			}
		}

		const managedKeys = new Set(
			managedRows.map(({ id }) => lowerCaseRowKey(id)),
		);

		for (const group of groups.filter(({ data }) => setsManagedBy(data))) {
			const hasUnmanagedKey = group.keys.some((key) => {
				return !managedKeys.has(lowerCaseRowKey(key));
			});

			if (hasUnmanagedKey) {
				throw new MembershipManagedBySetError();
			}
		}
	}

	override async createMany(
		data: Partial<Item>[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		// A new membership can only add admin or app users.
		opts.userIntegrityCheckFlags = (opts.userIntegrityCheckFlags
			?? UserIntegrityCheckFlag.None) | UserIntegrityCheckFlag.UserLimits;

		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		const result = await super.createMany(data, opts);

		// A new user's memberships land with the user: no cache holds them yet.
		if (!opts.createsNewUserMemberships) {
			await this.clearCaches(await this.readMemberUsers(result), opts);
		}

		return result;
	}

	override async updateGroups(
		groups: UpdateGroup<Item>[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		// A membership moved to another user changes the roles of both.
		const groupKeys = groups.flatMap(({ keys }) => keys);
		const usersBefore = await this.readMemberUsers(groupKeys);

		const result = await super.updateGroups(groups, opts);

		await this.clearCaches(
			[...usersBefore, ...await this.readMemberUsers(groupKeys)],
			opts,
		);

		return result;
	}

	override async deleteMany(
		keys: PrimaryKey[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		const memberUsers = await this.readMemberUsers(keys);
		const result = await super.deleteMany(keys, opts);

		await this.clearCaches(memberUsers, opts);

		return result;
	}
}
