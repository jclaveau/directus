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

		const result = await super.createMany(data, opts);

		await this.clearCaches(opts);

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
