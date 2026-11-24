import { InvalidPayloadError } from '@directus/errors';
import { oneLine } from '@directus/utils';
import type {
	AbstractServiceOptions,
	ActionEventParams,
	Item,
	MutationOptions,
	PrimaryKey,
	UpdateGroup,
} from '@directus/types';
import { UserIntegrityCheckFlag } from '@directus/types';
import { clearCachesAfterCommit } from '../utils/clear-caches-after-commit.js';
import {
	clearCachesThenFireActions,
} from '../utils/clear-caches-then-fire-actions.js';
import { transactionHoldingActions } from '../utils/transaction-holding-actions.js';
import { emitActionEvents, ItemsService } from './items.js';
import { AccessService } from './access.js';
import { PresetsService } from './presets.js';
import {
	refusePermissionModelWrite,
} from '../utils/refuse-permission-model-write.js';

const DESCENDANT_PARENT_REASON =
	'A role cannot have a parent that is already a descendant of itself';

export class RolesService extends ItemsService {
	constructor(options: AbstractServiceOptions) {
		super('directus_roles', options);
	}

	// No need to check user integrity in createOne, as the creation of a role itself does not influence the number of
	// users, as the role of a user is actually updated in the UsersService on the user, which will make sure to
	// initiate a user integrity check if necessary. Same goes for role nesting check as well as cache clearing.

	// A role reaches its parent's policies, so its parent is the permission
	// model's; a role with no parent grants nothing.
	protected override async validateRowsToCreate(
		rows: Partial<Item>[],
	): Promise<void> {
		if (rows.some((row) => row['parent'] !== null && row['parent'] !== undefined)) {
			refusePermissionModelWrite(this.accountability);
		}
	}

	protected override async validateGroupsToUpdate(
		groups: UpdateGroup<Item>[],
	): Promise<void> {
		if (groups.some(({ data }) => 'parent' in data)) {
			refusePermissionModelWrite(this.accountability);
		}
	}

	override async updateGroups(
		groups: UpdateGroup<Item>[],
		opts: MutationOptions = {},
	): Promise<PrimaryKey[]> {
		const parentGroups = groups.filter(({ data }) => 'parent' in data);

		if (parentGroups.length > 0) {
			await this.validateRoleNesting(parentGroups);
		}

		return await super.updateGroups(groups, opts);
	}

	protected override requiredIntegrityChecks(
		groups: UpdateGroup<Item>[],
	): UserIntegrityCheckFlag {
		// If the parent of a role changed we need to make a full integrity check.
		// Anything related to policies will be checked in the AccessService, where
		// the policies are attached to roles
		return groups.some(({ data }) => 'parent' in data)
			? UserIntegrityCheckFlag.All
			: UserIntegrityCheckFlag.None;
	}

	protected override async applyUpdateSideEffects(
		groups: UpdateGroup<Item>[],
	): Promise<void> {
		// Only clear the permissions cache if the parent role has changed
		// If anything policies related has changed, the cache will be cleared in the AccessService as well
		if (groups.some(({ data }) => 'parent' in data)) {
			await this.clearCaches();
		}
	}

	override async deleteMany(keys: PrimaryKey[], opts: MutationOptions = {}): Promise<PrimaryKey[]> {
		opts.userIntegrityCheckFlags = UserIntegrityCheckFlag.All;
		opts.onRequireUserIntegrityCheck?.(opts.userIntegrityCheckFlags);

		const heldActionEvents: ActionEventParams[] = [];

		const holdingOpts: MutationOptions = {
			...opts,
			bypassEmitAction: opts.bypassEmitAction ?? ((actionEvent) => {
				heldActionEvents.push(actionEvent);
			}),
		};

		await transactionHoldingActions(this.knex, heldActionEvents, async (trx) => {
			const heldUser = await trx
				.select('role')
				.from('directus_users')
				.whereIn('role', keys)
				.first();

			if (heldUser) {
				throw new InvalidPayloadError({
					reason: oneLine`Role ${JSON.stringify(heldUser.role)} can't be
						deleted while users belong to it`,
				});
			}

			const rolesItemsService = new ItemsService('directus_roles', {
				knex: trx,
				accountability: this.accountability,
				schema: this.schema,
			});

			// An empty role's cleanup is code's: its caller may delete the role
			// without holding a write on the permission model.
			const cleanupOptions: AbstractServiceOptions = {
				knex: trx,
				accountability: null,
				schema: this.schema,
			};

			const rolesService = new RolesService(cleanupOptions);
			const accessService = new AccessService(cleanupOptions);
			const presetsService = new PresetsService(cleanupOptions);

			await accessService.deleteRoleAccess(
				keys,
				{ ...holdingOpts, bypassLimits: true },
			);

			await presetsService.deleteByQuery(
				{
					filter: { role: { _in: keys } },
				},
				{ ...holdingOpts, bypassLimits: true },
			);

			// If the about to be deleted roles are the parent of other roles set those parents to null
			// Use a newly created RolesService here that works within the current transaction
			await rolesService.updateByQuery(
				{
					filter: { parent: { _in: keys } },
				},
				{ parent: null },
				{ bypassEmitAction: holdingOpts.bypassEmitAction },
			);

			await rolesItemsService.deleteMany(keys, holdingOpts);
		});

		// Since nested roles could be updated, clear caches
		await clearCachesThenFireActions(
			() => this.clearCaches(),
			() => emitActionEvents(heldActionEvents, opts),
			false,
		);

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
		await clearCachesAfterCommit(this.knex, this.cache, opts);
	}
}
