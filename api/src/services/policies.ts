import { InvalidPayloadError } from '@directus/errors';
import type {
	AbstractServiceOptions,
	MutationOptions,
	Policy,
	PrimaryKey,
	UpdateGroup,
} from '@directus/types';
import { UserIntegrityCheckFlag } from '@directus/types';
import { getMatch } from 'ip-matching';
import { clearSystemCache } from '../cache.js';
import { flushResponseCache } from '../scoped-cache/index.js';
import { clearCache as clearPermissionsCache } from '../permissions/cache.js';
import { ItemsService } from './items.js';

export class PoliciesService extends ItemsService<Policy> {
	constructor(options: AbstractServiceOptions) {
		super('directus_policies', options);
	}

	private async clearCaches(opts?: MutationOptions) {
		await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });

		if (this.cache && opts?.autoPurgeCache !== false) {
			await flushResponseCache(this.cache);
		}
	}

	private isIpAccessValid(value?: any[] | null): boolean {
		if (value === undefined) return false;
		if (value === null) return true;
		if (Array.isArray(value) && value.length === 0) return true;

		for (const ip of value) {
			if (typeof ip !== 'string' || ip.includes('*')) return false;

			try {
				const match = getMatch(ip);
				if (match.type == 'IPMask') return false;
			} catch {
				return false;
			}
		}

		return true;
	}

	private assertValidIpAccess(partialItem: Partial<Policy>): void {
		if ('ip_access' in partialItem && !this.isIpAccessValid(partialItem['ip_access'])) {
			throw new InvalidPayloadError({
				reason: 'IP Access contains an incorrect value. Valid values are: IP addresses, IP ranges and CIDR blocks',
			});
		}
	}

	override async createMany(data: Partial<Policy>[], opts: MutationOptions = {}): Promise<PrimaryKey[]> {
		for (const item of data) {
			this.assertValidIpAccess(item);
		}

		// A policy has been created, but the attachment to a user/role happens in the AccessService,
		// so no need to check user integrity

		const result = await super.createMany(data, opts);

		// TODO is this necessary? Since the attachment should be handled in the AccessService
		// A new policy has created, clear the permissions cache
		await clearPermissionsCache();

		return result;
	}

	override async updateGroups(
		groups: UpdateGroup<Policy>[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		for (const { data } of groups) {
			this.assertValidIpAccess(data);
		}

		return await super.updateGroups(groups, opts);
	}

	protected override requiredIntegrityChecks(
		groups: UpdateGroup<Policy>[],
	): UserIntegrityCheckFlag {
		let integrityCheckFlags = UserIntegrityCheckFlag.None;

		for (const { data } of groups) {
			if ('admin_access' in data) {
				integrityCheckFlags |= UserIntegrityCheckFlag.RemainingAdmins;

				if (data['admin_access'] === true) {
					// Only need a full user count if the policy allows admin access
					integrityCheckFlags |= UserIntegrityCheckFlag.All;
				}
			}

			if ('app_access' in data) {
				integrityCheckFlags |= UserIntegrityCheckFlag.UserLimits;
			}
		}

		return integrityCheckFlags;
	}

	protected override async applyUpdateSideEffects(
		groups: UpdateGroup<Policy>[],
		opts: MutationOptions,
	): Promise<void> {
		if (
			groups.some(({ data }) => {
				return ['admin_access', 'app_access', 'ip_access', 'enforce_tfa']
					.some((field) => field in data);
			})
		) {
			// Some relevant properties on policies have been updated, clear the caches
			await this.clearCaches(opts);
		}
	}

	override async deleteMany(keys: PrimaryKey[], opts: MutationOptions = {}): Promise<PrimaryKey[]> {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		const result = await super.deleteMany(keys, opts);

		// TODO is this necessary? Since the detachment should be handled in the AccessService
		// Some policies have been deleted, clear the permissions cache
		await this.clearCaches(opts);

		return result;
	}
}
