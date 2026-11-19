import { InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import { UserIntegrityCheckFlag } from '@directus/types';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSystemCache } from '../cache.js';
import { transaction } from '../utils/transaction.js';
import { ItemsService } from './items.js';
import { RoleMembersService } from './role-members.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('../permissions/modules/validate-access/validate-access.js');

vi.mock('../permissions/modules/process-payload/process-payload.js', () => {
	return {
		processPayload: vi.fn(async ({ payload }) => payload),
	};
});

vi.mock('../cache.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('../cache.js')>(),
		clearSystemCache: vi.fn(),
	};
});

const schema = new SchemaBuilder()
	.collection('directus_role_members', (c) => {
		c.field('id').uuid()
			.primary();
	})
	.build();

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(clearSystemCache).mockClear();
});

describe('Services / RoleMembers', () => {
	describe('createMany', () => {
		it('adds the user limits check to the requested ones', async () => {
			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['member-id-1', 'member-id-2']);

			const onRequireUserIntegrityCheck = vi.fn();

			await expect(new RoleMembersService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).createMany(
				[
					{ role: 'role-id-1', user: 'user-id-1' },
					{ role: 'role-id-1', user: 'user-id-2' },
				],
				{
					onRequireUserIntegrityCheck,
					userIntegrityCheckFlags: UserIntegrityCheckFlag.RemainingAdmins,
				},
			)).resolves.toStrictEqual(['member-id-1', 'member-id-2']);

			expect(onRequireUserIntegrityCheck).toHaveBeenCalledWith(
				UserIntegrityCheckFlag.RemainingAdmins
				| UserIntegrityCheckFlag.UserLimits,
			);

			expect(createMany).toHaveBeenCalledWith(
				[
					{ role: 'role-id-1', user: 'user-id-1' },
					{ role: 'role-id-1', user: 'user-id-2' },
				],
				{
					onRequireUserIntegrityCheck,
					userIntegrityCheckFlags: UserIntegrityCheckFlag.RemainingAdmins
						| UserIntegrityCheckFlag.UserLimits,
				},
			);

			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});

		it('requests the user limits check when none was requested', async () => {
			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['member-id-3']);

			await new RoleMembersService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).createOne({ role: 'role-id-3', user: 'user-id-3' });

			expect(createMany).toHaveBeenCalledWith(
				[{ role: 'role-id-3', user: 'user-id-3' }],
				{ userIntegrityCheckFlags: UserIntegrityCheckFlag.UserLimits },
			);

			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});

		it('clears the caches once the parent transaction has committed', async () => {
			vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['member-id-4']);

			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);
			const transactionStates: string[][] = [];

			vi.mocked(clearSystemCache).mockImplementationOnce(async () => {
				transactionStates.push(
					tracker.history.transactions.map((trx) => trx.state),
				);
			});

			await transaction(database, async (trx) => {
				await new RoleMembersService({ knex: trx, schema })
					.createOne({ role: 'role-id-4', user: 'user-id-4' });
			});

			expect(transactionStates).toEqual([['committed']]);
		});

		it('clears no cache for the memberships of users it creates', async () => {
			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['member-id-9']);

			await expect(new RoleMembersService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).createMany(
				[{ role: 'role-id-9', user: 'user-id-9' }],
				{ createsNewUserMemberships: true },
			)).resolves.toStrictEqual(['member-id-9']);

			expect(createMany).toHaveBeenCalledWith(
				[{ role: 'role-id-9', user: 'user-id-9' }],
				{
					createsNewUserMemberships: true,
					userIntegrityCheckFlags: UserIntegrityCheckFlag.UserLimits,
				},
			);

			expect(clearSystemCache).not.toHaveBeenCalled();
		});
	});

	describe('updateBatch', () => {
		it('requests every user integrity check and clears the caches', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['member-id-5']);

			const onRequireUserIntegrityCheck = vi.fn();

			await new RoleMembersService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateBatch(
				[{ id: 'member-id-5', role: 'role-id-5' }],
				{ onRequireUserIntegrityCheck },
			);

			expect(onRequireUserIntegrityCheck)
				.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);

			expect(updateGroups).toHaveBeenCalledWith(
				[{ data: { role: 'role-id-5' }, keys: ['member-id-5'] }],
				{
					onRequireUserIntegrityCheck,
					userIntegrityCheckFlags: UserIntegrityCheckFlag.All,
				},
			);

			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});

		it('requests every integrity check when no callback is given', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['member-id-6']);

			await new RoleMembersService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateBatch([{ id: 'member-id-6', sort: 2 }]);

			expect(updateGroups).toHaveBeenCalledWith(
				[{ data: { sort: 2 }, keys: ['member-id-6'] }],
				{ userIntegrityCheckFlags: UserIntegrityCheckFlag.All },
			);
		});
	});

	describe('deleteMany', () => {
		it('requests every user integrity check and clears the caches', async () => {
			const deleteMany = vi.spyOn(ItemsService.prototype, 'deleteMany')
				.mockResolvedValue(['member-id-7']);

			const onRequireUserIntegrityCheck = vi.fn();

			await expect(new RoleMembersService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).deleteMany(['member-id-7'], { onRequireUserIntegrityCheck }))
				.resolves.toStrictEqual(['member-id-7']);

			expect(onRequireUserIntegrityCheck)
				.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);

			expect(deleteMany).toHaveBeenCalledWith(['member-id-7'], {
				onRequireUserIntegrityCheck,
				userIntegrityCheckFlags: UserIntegrityCheckFlag.All,
			});

			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});

		it('clears the caches of a delete made without options', async () => {
			vi.spyOn(ItemsService.prototype, 'deleteMany')
				.mockResolvedValue(['member-id-8']);

			await new RoleMembersService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).deleteMany(['member-id-8']);

			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});
	});

	describe('managed_by', () => {
		it('refuses a request setting managed_by', async () => {
			const database = knex.default({ client: MockClient });

			createTracker(database);

			await expect(new RoleMembersService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					memberRoles: [],
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).createOne({
				managed_by: 'invite',
				role: 'role-id-10',
				user: 'user-id-10',
			})).rejects.toThrow(new InvalidPayloadError({
				reason: '"managed_by" is set by the code managing the membership,'
					+ ' not by a request',
			}));
		});

		it('lets the invite code, without accountability, set managed_by', async () => {
			await expect(new RoleMembersService({
				knex: knex.default({ client: MockClient }),
				schema,
			})['validateRowsToCreate']([{
				managed_by: 'invite',
				role: 'role-id-10',
				user: 'user-id-10',
			}])).resolves.toBeUndefined();
		});

		it('lets a request create a membership given by hand', async () => {
			await expect(new RoleMembersService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					memberRoles: [],
					roles: [],
					user: 'admin-id-1',
				},
				knex: knex.default({ client: MockClient }),
				schema,
			})['validateRowsToCreate']([{
				managed_by: null,
				role: 'role-id-10',
				user: 'user-id-10',
			}])).resolves.toBeUndefined();
		});

		it('refuses a request moving a managed membership', async () => {
			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);

			tracker.on
				.select('directus_role_members')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000011',
					managed_by: 'auth:mockoauth',
					user: 'user-id-11',
					role: 'role-id-11',
				}]);

			await expect(new RoleMembersService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					memberRoles: [],
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000011', {
				role: 'role-id-1',
			})).rejects.toThrow(new InvalidPayloadError({
				reason: 'Membership "6f1c2a4e-0000-4000-8000-000000000011" is managed'
					+ ' by "auth:mockoauth": the next login of user "user-id-11" sets it'
					+ ' from that provider\'s ROLE_MAPPING',
			}));

			expect(tracker.history.select).toMatchObject([
				{
					sql: 'select "id", "managed_by", "user", "role"'
						+ ' from "directus_role_members"'
						+ ' where "id" in (?) and "managed_by" is not null',
					bindings: ['6f1c2a4e-0000-4000-8000-000000000011'],
				},
			]);
		});

		it('refuses a request moving a membership an extension manages', async () => {
			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);

			tracker.on
				.select('directus_role_members')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000014',
					managed_by: 'ext:subscription',
					user: 'user-id-14',
					role: 'role-id-14',
				}]);

			await expect(new RoleMembersService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					memberRoles: [],
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000014', {
				user: 'user-id-1',
			})).rejects.toThrow(new Error(
				'Invalid payload. Membership "6f1c2a4e-0000-4000-8000-000000000014"'
				+ ' is managed by "ext:subscription", which alone changes it.',
			));
		});

		it('lets a request reorder a managed membership', async () => {
			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);

			tracker.on
				.select('directus_role_members')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000015',
					managed_by: 'invite',
					user: 'user-id-15',
					role: 'role-id-15',
				}]);

			await expect(new RoleMembersService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					memberRoles: [],
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			})['validateGroupsToUpdate'](
				[{
					keys: ['6f1c2a4e-0000-4000-8000-000000000015'],
					data: { sort: 3, role: 'role-id-15' },
				}],
				database,
			)).resolves.toBeUndefined();
		});

		it('refuses managed_by sent for a membership given by hand', async () => {
			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);

			tracker.on.select('directus_role_members').response([]);

			await expect(new RoleMembersService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					memberRoles: [],
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000012', {
				managed_by: 'invite',
			})).rejects.toThrow(new InvalidPayloadError({
				reason: '"managed_by" is set by the code managing the membership,'
					+ ' not by a request',
			}));
		});

		it('refuses a request deleting a managed membership', async () => {
			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);

			tracker.on
				.select('directus_role_members')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000013',
					managed_by: 'invite',
					user: 'user-id-13',
					role: 'role-id-13',
				}]);

			await expect(new RoleMembersService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					memberRoles: [],
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).deleteMany([
				'6f1c2a4e-0000-4000-8000-000000000001',
				'6f1c2a4e-0000-4000-8000-000000000013',
			])).rejects.toThrow(new InvalidPayloadError({
				reason: 'Membership "6f1c2a4e-0000-4000-8000-000000000013" comes from'
					+ ' the invites of user "user-id-13" to role "role-id-13": delete'
					+ ' those invites to remove it',
			}));

			expect(tracker.history.select).toMatchObject([
				{
					sql: 'select "id", "managed_by", "user", "role"'
						+ ' from "directus_role_members"'
						+ ' where "id" in (?, ?) and "managed_by" is not null',
					bindings: [
						'6f1c2a4e-0000-4000-8000-000000000001',
						'6f1c2a4e-0000-4000-8000-000000000013',
					],
				},
			]);
		});

		it('lets a role delete take its managed memberships along', async () => {
			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);

			await expect(new RoleMembersService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					memberRoles: [],
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			})['validateKeysToDelete'](
				['6f1c2a4e-0000-4000-8000-000000000013'],
				{ deletesManagedMemberships: true },
				database,
			)).resolves.toBeUndefined();

			expect(tracker.history.select).toEqual([]);
		});
	});
});
