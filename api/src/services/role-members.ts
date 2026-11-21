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

type MembershipRow = {
	id: string;
	managed_by: string | null;
	user: string;
	role: string;
};

type ManagedMembershipRow = MembershipRow & { managed_by: string };

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

/**
 * The user a created membership names, by its key or as `{ id, ... }`. One
 * without a key is a user the same request creates: it holds no socket yet.
 */
function existingMemberUser(memberUser: unknown): string[] {
	if (typeof memberUser === 'string') {
		return [lowerCaseRowKey(memberUser)];
	}

	const relatedKey = typeof memberUser === 'object' && memberUser !== null
		? (memberUser as { id?: unknown }).id
		: undefined;

	if (typeof relatedKey === 'string') {
		return [lowerCaseRowKey(relatedKey)];
	}

	return [];
}

class ManagedMembershipChangeError extends InvalidPayloadError {
	constructor(managedMembership: ManagedMembershipRow) {
		super({ reason: managedMembershipReason(managedMembership) });
	}
}

class MembershipUserChangeError extends InvalidPayloadError {
	constructor(membership: MembershipRow, sentUser: unknown) {
		super({
			reason: `Membership ${JSON.stringify(membership.id)} gives role`
				+ ` ${JSON.stringify(membership.role)} to user`
				+ ` ${JSON.stringify(membership.user)}, which can't change to`
				+ ` ${JSON.stringify(sentUser)}: delete it and create one for that`
				+ ' user',
		});
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
 *
 * No write, a request's or the code's, hands a membership to another user: its
 * `user` is the one whose roles it changes.
 */
export class RoleMembersService extends ItemsService {
	protected override readonly writtenRowColumns = ['user'];

	constructor(options: AbstractServiceOptions) {
		super('directus_role_members', options);
	}

	// A membership changes no schema: the permissions cache, whose own clear
	// reaches the other nodes, and the response cache are what it leaves stale,
	// with the roles of the sockets its users hold open.
	private async clearCaches(opts?: MutationOptions) {
		await clearPermissionsCacheAfterCommit(this.knex);
		await flushResponseCacheAfterCommit(this.knex, this.cache, opts);
	}

	// The users of the memberships an update or a delete wrote, off the write
	// statement's own RETURNING.
	protected override async onKeyRowsWritten(
		writtenRows: Item[],
		trx: Knex,
	): Promise<void> {
		await announceMembershipsChangedAfterCommit(
			trx,
			writtenRows.map(({ user }) => user),
		);
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
		return await this.membershipRowsQuery(keys, trx).whereNotNull('managed_by');
	}

	private membershipRowsQuery(keys: PrimaryKey[], trx: Knex) {
		return trx
			.select('id', 'managed_by', ...MEMBERSHIP_GRANT_FIELDS)
			.from('directus_role_members')
			.whereIn('id', keys);
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
	 * as it is stored changes nothing, so it is no refusal. A group sending
	 * `user` reads every row it names, managed or not, to refuse a move.
	 */
	protected override async validateGroupsToUpdate(
		groups: UpdateGroup<Item>[],
		trx: Knex,
	): Promise<void> {
		const sendsMemberUser = groups.some(({ data }) => 'user' in data);

		if (!this.accountability && !sendsMemberUser) {
			return;
		}

		const groupKeys = groups.flatMap((group) => group.keys);

		const membershipRows: MembershipRow[] = sendsMemberUser
			? await this.membershipRowsQuery(groupKeys, trx)
			: await this.readManagedMemberships(groupKeys, trx);

		const dataByKey = groupDataByKey(groups);

		if (this.accountability) {
			this.refuseManagedMembershipChanges(membershipRows, dataByKey, groups);
		}

		for (const membership of membershipRows) {
			const movingData = dataByKey.get(lowerCaseRowKey(membership.id))
				?.find((data) => changesGrantField(data, membership, ['user']));

			if (movingData) {
				throw new MembershipUserChangeError(membership, movingData['user']);
			}
		}
	}

	private refuseManagedMembershipChanges(
		membershipRows: MembershipRow[],
		dataByKey: Map<string, Partial<Item>[]>,
		groups: UpdateGroup<Item>[],
	): void {
		const managedRows = membershipRows.filter(
			(membership): membership is ManagedMembershipRow => {
				return membership.managed_by !== null;
			},
		);

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
			await this.clearCaches(opts);

			await announceMembershipsChangedAfterCommit(
				this.knex,
				data.flatMap((row) => existingMemberUser(row['user'])),
			);
		}

		return result;
	}

	override async updateGroups(
		groups: UpdateGroup<Item>[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		const result = await super.updateGroups(groups, opts);

		await this.clearCaches(opts);

		return result;
	}

	override async deleteMany(
		keys: PrimaryKey[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		const result = await super.deleteMany(keys, opts);

		await this.clearCaches(opts);

		return result;
	}
}
