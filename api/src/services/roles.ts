import { InvalidPayloadError } from '@directus/errors';
import type {
	AbstractServiceOptions,
	Item,
	MutationOptions,
	PrimaryKey,
	UpdateGroup,
} from '@directus/types';
import { UserIntegrityCheckFlag } from '@directus/types';
import { clearSystemCache } from '../cache.js';
import { flushResponseCache } from '../scoped-cache/index.js';
import { transaction } from '../utils/transaction.js';
import { ItemsService } from './items.js';
import { AccessService } from './access.js';
import { PresetsService } from './presets.js';
import { UsersService } from './users.js';

const DESCENDANT_PARENT_REASON =
	'A role cannot have a parent that is already a descendant of itself';

export class RolesService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_roles', options);
	}

	// No need to check user integrity in createOne, as the creation of a role itself does not influence the number of
	// users, as the role of a user is actually updated in the UsersService on the user, which will make sure to
	// initiate a user integrity check if necessary. Same goes for role nesting check as well as cache clearing.

	override async updateGroups(
		groups: UpdateGroup<Item>[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		const parentGroups = groups.filter(({ data }) => 'parent' in data);

		if (parentGroups.length > 0) {
			// If the parent of a role changed we need to make a full integrity check.
			// Anything related to policies will be checked in the AccessService, where the policies are attached to roles
			opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
			opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

			await this.validateRoleNesting(parentGroups);
		}

		const result = await super.updateGroups(groups, opts);

		// Only clear the permissions cache if the parent role has changed
		// If anything policies related has changed, the cache will be cleared in the AccessService as well
		if (parentGroups.length > 0) {
			await this.clearCaches();
		}

		return result;
	}

	override async deleteMany(keys: PrimaryKey[], opts: MutationOptions = {}): Promise<PrimaryKey[]> {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		await transaction(this.knex, async (trx) => {
			const options: AbstractServiceOptions = {
				knex: trx,
				accountability: this.accountability,
				schema: this.schema,
			};

			const rolesItemsService = new ItemsService('directus_roles', options);
			const rolesService = new RolesService(options);
			const accessService = new AccessService(options);
			const presetsService = new PresetsService(options);
			const usersService = new UsersService(options);

			// Delete permissions/presets for this role, suspend all remaining users in role

			await accessService.deleteByQuery(
				{
					filter: { role: { _in: keys } },
				},
				{ ...opts, bypassLimits: true },
			);

			await presetsService.deleteByQuery(
				{
					filter: { role: { _in: keys } },
				},
				{ ...opts, bypassLimits: true },
			);

			await usersService.updateByQuery(
				{
					filter: { role: { _in: keys } },
				},
				{
					status: 'suspended',
					role: null,
				},
				{ ...opts, bypassLimits: true },
			);

			// If the about to be deleted roles are the parent of other roles set those parents to null
			// Use a newly created RolesService here that works within the current transaction
			await rolesService.updateByQuery(
				{
					filter: { parent: { _in: keys } },
				},
				{ parent: null },
			);

			await rolesItemsService.deleteMany(keys, opts);
		});

		// Since nested roles could be updated, clear caches
		await this.clearCaches();

		return keys;
	}

	// A batch can close a loop no single row closes (A under B, B under A), so a
	// climb reads the parent the batch is about to write before the stored one.
	private async validateRoleNesting(parentGroups: UpdateGroup<Item>[]) {
		// Postgres matches a uuid whatever its casing, so the check compares ids
		// lower-cased.
		const normalizeRoleId = (roleId: unknown) => {
			if (!roleId) {
				return null;
			}

			return String(roleId).toLowerCase();
		};

		const parentsInBatch = new Map<string, string | null>();

		for (const { data, keys } of parentGroups) {
			for (const key of keys) {
				parentsInBatch.set(
					String(key).toLowerCase(),
					normalizeRoleId(data['parent']),
				);
			}
		}

		const storedParents = new Map<string, string | null>();

		const readParent = async (roleId: string) => {
			if (parentsInBatch.has(roleId)) {
				return parentsInBatch.get(roleId) ?? null;
			}

			if (!storedParents.has(roleId)) {
				const role = await this.knex
					.select('parent')
					.from('directus_roles')
					.where({ id: roleId })
					.first();

				storedParents.set(roleId, normalizeRoleId(role?.parent));
			}

			return storedParents.get(roleId) ?? null;
		};

		for (const [roleId, parentId] of parentsInBatch) {
			if (parentId === roleId) {
				throw new InvalidPayloadError({
					reason: 'A role cannot be a parent of itself',
				});
			}

			const climbedRoles = new Set<string>();
			let ancestorId = parentId;

			// A loop above the role that does not pass through it is another row's
			// to refuse, so the climb stops there.
			while (ancestorId && !climbedRoles.has(ancestorId)) {
				if (ancestorId === roleId) {
					throw new InvalidPayloadError({ reason: DESCENDANT_PARENT_REASON });
				}

				climbedRoles.add(ancestorId);
				ancestorId = await readParent(ancestorId);
			}
		}
	}

	private async clearCaches(opts?: MutationOptions) {
		await clearSystemCache({ autoPurgeCache: opts?.autoPurgeCache });

		if (this.cache && opts?.autoPurgeCache !== false) {
			await flushResponseCache(this.cache);
		}
	}
}
