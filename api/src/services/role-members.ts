import { InvalidPayloadError } from '@directus/errors';
import {
	type AbstractServiceOptions,
	type Item,
	type MutationOptions,
	type PrimaryKey,
	type UpdateGroup,
	UserIntegrityCheckFlag,
} from '@directus/types';
import { clearCachesAfterCommit } from '../utils/clear-caches-after-commit.js';
import { ItemsService } from './items.js';

/**
 * A membership gives a user a role (#746). Its writes change what the user
 * may do, so each clears the caches holding the user's roles, and each but a
 * create may leave the instance with no admin.
 */
export class RoleMembersService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_role_members', options);
	}

	private async clearCaches(opts?: MutationOptions) {
		await clearCachesAfterCommit(this.knex, this.cache, opts);
	}

	override async createMany(
		data: Partial<Item>[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		// A new membership can only add admin or app users.
		opts.userIntegrityCheckFlags = (opts.userIntegrityCheckFlags
			?? UserIntegrityCheckFlag.None) | UserIntegrityCheckFlag.UserLimits;

		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		const result = await super.createMany(
			await this.placedMemberships(data),
			opts,
		);

		await this.clearCaches(opts);

		return result;
	}

	/**
	 * Refuses a role the user already holds from the same manager, and puts a
	 * membership given by an invite or a provider after the user's others.
	 * user-1 holds sort 1 and 3; + press (invite:a), sso (auth:x), hand (null)
	 * → press sort 4, sso sort 5, hand as sent
	 */
	private async placedMemberships(data: Partial<Item>[]) {
		const memberUserIds = [...new Set(data.map(({ user }) => user))]
			.filter((user) => typeof user === 'string');

		const heldMemberships: Partial<Item>[] = memberUserIds.length === 0
			? []
			: await this.knex
				.select('user', 'role', 'managed_by', 'sort')
				.from('directus_role_members')
				.whereIn('user', memberUserIds);

		const lastSortByUser = new Map<string, number>();

		for (const { user, sort } of heldMemberships) {
			lastSortByUser.set(
				user,
				Math.max(lastSortByUser.get(user) ?? 0, sort ?? 0),
			);
		}

		const placedMemberships: Partial<Item>[] = [];

		for (const membership of data) {
			const managedBy = membership['managed_by'] ?? null;

			const isHeldAlready = [...heldMemberships, ...placedMemberships]
				.some(({ user, role, managed_by }) => {
					return user === membership['user']
						&& role === membership['role']
						&& (managed_by ?? null) === managedBy;
				});

			if (isHeldAlready) {
				throw new InvalidPayloadError({
					reason: `The user ${JSON.stringify(membership['user'])}`
						+ ` already holds the role ${JSON.stringify(membership['role'])}`
						+ ` with managed_by ${JSON.stringify(managedBy)}`,
				});
			}

			if (managedBy === null || membership['sort'] != null) {
				lastSortByUser.set(
					membership['user'],
					Math.max(
						lastSortByUser.get(membership['user']) ?? 0,
						membership['sort'] ?? 0,
					),
				);

				placedMemberships.push(membership);
				continue;
			}

			const placedSort = (lastSortByUser.get(membership['user']) ?? 0) + 1;

			lastSortByUser.set(membership['user'], placedSort);
			placedMemberships.push({ ...membership, sort: placedSort });
		}

		return placedMemberships;
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
