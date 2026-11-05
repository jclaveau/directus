import { ForbiddenError, InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import { UserIntegrityCheckFlag } from '@directus/types';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSystemCache } from '../cache.js';
import {
	validateAccess,
} from '../permissions/modules/validate-access/validate-access.js';
import { AccessService } from './access.js';
import { transaction } from '../utils/transaction.js';
import { ItemsService } from './items.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('../cache.js', async (importOriginal) => {
	return {
		...await importOriginal<typeof import('../cache.js')>(),
		clearSystemCache: vi.fn(),
	};
});

vi.mock('../permissions/modules/validate-access/validate-access.js');

const schema = new SchemaBuilder()
	.collection('directus_access', (c) => {
		c.field('id').uuid()
			.primary();
	})
	.build();

afterEach(() => {
	vi.restoreAllMocks();
	vi.mocked(clearSystemCache).mockClear();
});

describe('Services / Access', () => {
	describe('createMany', () => {
		it('adds the user limits check to the requested ones', async () => {
			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['access-id-2', 'access-id-5']);

			const onRequireUserIntegrityCheck = vi.fn();

			await expect(new AccessService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).createMany(
				[
					{ policy: 'policy-id-2', user: 'user-id-1' },
					{ policy: 'policy-id-2', user: 'user-id-2' },
				],
				{
					onRequireUserIntegrityCheck,
					userIntegrityCheckFlags: UserIntegrityCheckFlag.RemainingAdmins,
				},
			)).resolves.toStrictEqual(['access-id-2', 'access-id-5']);

			expect(onRequireUserIntegrityCheck).toHaveBeenCalledWith(
				UserIntegrityCheckFlag.RemainingAdmins
				| UserIntegrityCheckFlag.UserLimits,
			);

			expect(createMany).toHaveBeenCalledWith(
				[
					{ policy: 'policy-id-2', user: 'user-id-1' },
					{ policy: 'policy-id-2', user: 'user-id-2' },
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
				.mockResolvedValue(['access-id-3']);

			await new AccessService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).createOne({ policy: 'policy-id-3', role: 'role-id-1' });

			expect(createMany).toHaveBeenCalledWith(
				[{ policy: 'policy-id-3', role: 'role-id-1' }],
				{ userIntegrityCheckFlags: UserIntegrityCheckFlag.UserLimits },
			);

			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});

		it('clears the caches once the parent transaction has committed', async () => {
			vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['access-id-6']);

			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);
			const transactionStates: string[][] = [];

			vi.mocked(clearSystemCache).mockImplementationOnce(async () => {
				transactionStates.push(
					tracker.history.transactions.map((trx) => trx.state),
				);
			});

			await transaction(database, async (trx) => {
				await new AccessService({ knex: trx, schema })
					.createOne({ policy: 'policy-id-6', role: 'role-id-6' });
			});

			expect(transactionStates).toEqual([['committed']]);
		});
	});

	describe('deleteMany', () => {
		it('requests every user integrity check and clears the caches', async () => {
			const deleteMany = vi.spyOn(ItemsService.prototype, 'deleteMany')
				.mockResolvedValue(['access-id-4']);

			const onRequireUserIntegrityCheck = vi.fn();

			await expect(new AccessService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).deleteMany(['access-id-4'], { onRequireUserIntegrityCheck }))
				.resolves.toStrictEqual(['access-id-4']);

			expect(onRequireUserIntegrityCheck)
				.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);

			expect(deleteMany).toHaveBeenCalledWith(['access-id-4'], {
				onRequireUserIntegrityCheck,
				userIntegrityCheckFlags: UserIntegrityCheckFlag.All,
			});

			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});
	});

	describe('updateBatch', () => {
		it('requests every user integrity check and clears the caches', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['access-id-1']);

			const onRequireUserIntegrityCheck = vi.fn();

			await new AccessService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateBatch(
				[{ id: 'access-id-1', policy: 'policy-id-1' }],
				{ onRequireUserIntegrityCheck },
			);

			expect(onRequireUserIntegrityCheck)
				.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);

			expect(updateGroups).toHaveBeenCalledWith(
				[{ data: { policy: 'policy-id-1' }, keys: ['access-id-1'] }],
				{
					onRequireUserIntegrityCheck,
					userIntegrityCheckFlags: UserIntegrityCheckFlag.All,
				},
			);

			expect(clearSystemCache).toHaveBeenCalledTimes(1);
		});
	});

	describe('managed_by', () => {
		it('refuses a request setting managed_by', async () => {
			await expect(new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: knex.default({ client: MockClient }),
				schema,
			}).createOne({
				managed_by: '@scalabus/subscriptions',
				policy: 'policy-id-7',
				user: 'user-id-7',
			})).rejects.toThrow(new InvalidPayloadError({
				reason: '"managed_by" is set by the extension granting the access,'
					+ ' not by a request',
			}));
		});

		it('lets an extension, without accountability, set managed_by', async () => {
			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['access-id-7']);

			await new AccessService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).createOne({
				managed_by: '@scalabus/subscriptions',
				policy: 'policy-id-7',
				user: 'user-id-7',
			});

			expect(createMany).toHaveBeenCalledWith(
				[
					{
						managed_by: '@scalabus/subscriptions',
						policy: 'policy-id-7',
						user: 'user-id-7',
					},
				],
				{ userIntegrityCheckFlags: UserIntegrityCheckFlag.UserLimits },
			);
		});

		it('refuses a request setting managed_by on an unmanaged access', async () => {
			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([]);

			await expect(new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000001', {
				managed_by: '@scalabus/subscriptions',
			})).rejects.toThrow(new InvalidPayloadError({
				reason: '"managed_by" is set by the extension granting the access,'
					+ ' not by a request',
			}));
		});

		it('answers a 403 to a request with no access setting managed_by', async () => {
			vi.mocked(validateAccess).mockRejectedValueOnce(new ForbiddenError());

			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([]);

			const accountability = {
				admin: false,
				app: false,
				ip: null,
				role: null,
				roles: [],
				user: null,
			};

			await expect(new AccessService({
				accountability,
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000001', {
				managed_by: '@scalabus/subscriptions',
			})).rejects.toThrow(new ForbiddenError());

			expect(validateAccess).toHaveBeenLastCalledWith(
				{
					accountability,
					action: 'update',
					collection: 'directus_access',
					fields: ['managed_by'],
					primaryKeys: ['6f1c2a4e-0000-4000-8000-000000000001'],
				},
				{ knex: database, schema },
			);
		});

		it('lets a request create an access with a null managed_by', async () => {
			const createMany = vi.spyOn(ItemsService.prototype, 'createMany')
				.mockResolvedValue(['access-id-7']);

			await new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: knex.default({ client: MockClient }),
				schema,
			}).createOne({
				managed_by: null,
				policy: 'policy-id-7',
				user: 'user-id-7',
			});

			expect(createMany).toHaveBeenCalledWith(
				[{ managed_by: null, policy: 'policy-id-7', user: 'user-id-7' }],
				{ userIntegrityCheckFlags: UserIntegrityCheckFlag.UserLimits },
			);
		});

		it('lets a request send back the null managed_by it read', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['6f1c2a4e-0000-4000-8000-000000000001']);

			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([]);

			await new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000001', {
				managed_by: null,
				policy: 'policy-id-1',
			});

			expect(updateGroups).toHaveBeenCalledWith(
				[{
					keys: ['6f1c2a4e-0000-4000-8000-000000000001'],
					data: { managed_by: null, policy: 'policy-id-1' },
				}],
				expect.anything(),
			);
		});

		it('lets a request send back the managed row it read', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['6f1c2a4e-0000-4000-8000-000000000007']);

			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
					.response([{
						id: '6f1c2a4e-0000-4000-8000-000000000007',
						managed_by: '@scalabus/subscriptions',
						role: null,
						user: 'user-id-7',
						policy: 'policy-id-7',
					}]);

			await new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000007', {
				managed_by: '@scalabus/subscriptions',
				role: null,
				user: 'user-id-7',
				policy: 'policy-id-7',
				sort: 2,
			});

			expect(updateGroups).toHaveBeenCalledWith(
				[{
					keys: ['6f1c2a4e-0000-4000-8000-000000000007'],
					data: {
						managed_by: '@scalabus/subscriptions',
						role: null,
						user: 'user-id-7',
						policy: 'policy-id-7',
						sort: 2,
					},
				}],
				expect.anything(),
			);
		});

		it.each([
			null,
			'@scalabus/other',
			'@SCALABUS/subscriptions',
		])('refuses a request turning a managed_by into %j', async (managedBy) => {
			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
					.response([{
						id: '6f1c2a4e-0000-4000-8000-000000000007',
						managed_by: '@scalabus/subscriptions',
						role: null,
						user: 'user-id-7',
						policy: 'policy-id-7',
					}]);

			await expect(new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000007', {
				managed_by: managedBy,
			})).rejects.toThrow(new InvalidPayloadError({
				reason: 'Access "6f1c2a4e-0000-4000-8000-000000000007" is managed by'
					+ ' "@scalabus/subscriptions", which alone changes it',
			}));
		});

		it('lets an extension, without accountability, update managed_by', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['6f1c2a4e-0000-4000-8000-000000000001']);

			await new AccessService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000001', {
				managed_by: '@scalabus/subscriptions',
			});

			expect(updateGroups).toHaveBeenCalledWith(
				[{
					keys: ['6f1c2a4e-0000-4000-8000-000000000001'],
					data: { managed_by: '@scalabus/subscriptions' },
				}],
				expect.anything(),
			);
		});

		it('refuses a request updating a managed access', async () => {
			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);

			tracker.on
				.select('directus_access')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
					role: null,
					user: 'user-id-7',
					policy: 'policy-id-7',
				}]);

			await expect(new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000007', {
				policy: 'policy-id-1',
			})).rejects.toThrow(new InvalidPayloadError({
				reason: 'Access "6f1c2a4e-0000-4000-8000-000000000007" is managed by'
					+ ' "@scalabus/subscriptions", which alone changes it',
			}));

			expect(tracker.history.select).toMatchObject([
				{
					sql: 'select "id", "managed_by", "role", "user", "policy"'
						+ ' from "directus_access"'
						+ ' where "id" in (?) and "managed_by" is not null',
					bindings: ['6f1c2a4e-0000-4000-8000-000000000007'],
				},
			]);
		});

		it('lets a request reorder a managed access', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['6f1c2a4e-0000-4000-8000-000000000007']);

			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
					role: null,
					user: 'user-id-7',
					policy: 'policy-id-7',
				}]);

			await new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000007', { sort: 2 });

			expect(updateGroups).toHaveBeenCalledWith(
				[{ keys: ['6f1c2a4e-0000-4000-8000-000000000007'], data: { sort: 2 } }],
				expect.anything(),
			);
		});

		it('lets a request save a managed access with its own policy', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['6f1c2a4e-0000-4000-8000-000000000007']);

			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
					role: null,
					user: 'user-id-7',
					policy: 'policy-id-7',
				}]);

			await new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000007', {
				sort: 2,
				policy: { id: 'policy-id-7', admin_access: false },
			});

			expect(updateGroups).toHaveBeenCalledWith(
				[{
					keys: ['6f1c2a4e-0000-4000-8000-000000000007'],
					data: { sort: 2, policy: { id: 'policy-id-7', admin_access: false } },
				}],
				expect.anything(),
			);
		});

		it('refuses a request moving a managed access to a policy object', async () => {
			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
					role: null,
					user: 'user-id-7',
					policy: 'policy-id-7',
				}]);

			await expect(new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6F1C2A4E-0000-4000-8000-000000000007', {
				policy: { id: 'policy-id-1' },
			})).rejects.toThrow(new InvalidPayloadError({
				reason: 'Access "6f1c2a4e-0000-4000-8000-000000000007" is managed by'
					+ ' "@scalabus/subscriptions", which alone changes it',
			}));
		});

		it('answers a request with no delete access a 403', async () => {
			vi.mocked(validateAccess).mockRejectedValueOnce(new ForbiddenError());

			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
					role: null,
					user: 'user-id-7',
					policy: 'policy-id-7',
				}]);

			const accountability = {
				admin: false,
				app: false,
				ip: null,
				role: null,
				roles: [],
				user: null,
			};

			await expect(new AccessService({
				accountability,
				knex: database,
				schema,
			}).deleteMany(['6f1c2a4e-0000-4000-8000-000000000007']))
				.rejects.toThrow(new ForbiddenError());

			expect(validateAccess).toHaveBeenLastCalledWith(
				{
					accountability,
					action: 'delete',
					collection: 'directus_access',
					primaryKeys: ['6f1c2a4e-0000-4000-8000-000000000007'],
				},
				{ knex: database, schema },
			);
		});

		it('answers a request with no update access a 403', async () => {
			vi.mocked(validateAccess).mockRejectedValueOnce(new ForbiddenError());

			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
					role: null,
					user: 'user-id-7',
					policy: 'policy-id-7',
				}]);

			const accountability = {
				admin: false,
				app: false,
				ip: null,
				role: null,
				roles: [],
				user: null,
			};

			await expect(new AccessService({
				accountability,
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000007', {
				policy: 'policy-id-1',
			})).rejects.toThrow(new ForbiddenError());

			expect(validateAccess).toHaveBeenLastCalledWith(
				{
					accountability,
					action: 'update',
					collection: 'directus_access',
					primaryKeys: ['6f1c2a4e-0000-4000-8000-000000000007'],
					fields: ['policy'],
				},
				{ knex: database, schema },
			);
		});

		it('refuses a request creating the role of a managed access', async () => {
			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
					role: null,
					user: 'user-id-7',
					policy: 'policy-id-7',
				}]);

			await expect(new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000007', {
				role: { id: null, name: 'Created role' },
			})).rejects.toThrow(new InvalidPayloadError({
				reason: 'Access "6f1c2a4e-0000-4000-8000-000000000007" is managed by'
					+ ' "@scalabus/subscriptions", which alone changes it',
			}));
		});

		it('lets a request send a managed user key in another case', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['6f1c2a4e-0000-4000-8000-000000000007']);

			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
					role: null,
					user: 'user-id-7',
					policy: 'policy-id-7',
				}]);

			await new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000007', {
				sort: 2,
				user: 'USER-ID-7',
			});

			expect(updateGroups).toHaveBeenCalledWith(
				[{
					keys: ['6f1c2a4e-0000-4000-8000-000000000007'],
					data: { sort: 2, user: 'USER-ID-7' },
				}],
				expect.anything(),
			);
		});

		it('lets a batch move one access and reorder a managed one', async () => {
			const updateGroups = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue([
					'6f1c2a4e-0000-4000-8000-000000000001',
					'6f1c2a4e-0000-4000-8000-000000000007',
				]);

			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
					role: null,
					user: 'user-id-7',
					policy: 'policy-id-7',
				}]);

			await new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateBatch([
				{ id: '6f1c2a4e-0000-4000-8000-000000000001', policy: 'policy-id-1' },
				{ id: '6f1c2a4e-0000-4000-8000-000000000007', sort: 2 },
			]);

			expect(updateGroups).toHaveBeenCalledWith(
				[
					{
						data: { policy: 'policy-id-1' },
						keys: ['6f1c2a4e-0000-4000-8000-000000000001'],
					},
					{
						data: { sort: 2 },
						keys: ['6f1c2a4e-0000-4000-8000-000000000007'],
					},
				],
				expect.anything(),
			);
		});

		it('refuses a request nulling the user of a managed access', async () => {
			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
					role: null,
					user: 'user-id-7',
					policy: 'policy-id-7',
				}]);

			await expect(new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000007', {
				user: null,
			})).rejects.toThrow(new InvalidPayloadError({
				reason: 'Access "6f1c2a4e-0000-4000-8000-000000000007" is managed by'
					+ ' "@scalabus/subscriptions", which alone changes it',
			}));
		});

		it('deletes the managed access of a deleted role', async () => {
			const deleteMany = vi.spyOn(ItemsService.prototype, 'deleteMany')
				.mockResolvedValue(['6f1c2a4e-0000-4000-8000-000000000007']);

			const getKeysByQuery = vi.spyOn(ItemsService.prototype, 'getKeysByQuery')
				.mockResolvedValue(['6f1c2a4e-0000-4000-8000-000000000007']);

			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);

			await expect(new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).deleteRoleAccess(['role-id-7']))
				.resolves.toStrictEqual(['6f1c2a4e-0000-4000-8000-000000000007']);

			expect(getKeysByQuery).toHaveBeenCalledWith({
				filter: { role: { _in: ['role-id-7'] } },
			});

			expect(deleteMany).toHaveBeenCalledWith(
				['6f1c2a4e-0000-4000-8000-000000000007'],
				{
					keysFromQuery: true,
					userIntegrityCheckFlags: UserIntegrityCheckFlag.All,
				},
			);

			expect(tracker.history.select).toStrictEqual([]);
		});

		it('passes the options of a role delete on to the access rows', async () => {
			const deleteMany = vi.spyOn(ItemsService.prototype, 'deleteMany')
				.mockResolvedValue(['6f1c2a4e-0000-4000-8000-000000000007']);

			vi.spyOn(ItemsService.prototype, 'getKeysByQuery')
				.mockResolvedValue(['6f1c2a4e-0000-4000-8000-000000000007']);

			await new AccessService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).deleteRoleAccess(
				['role-id-7'],
				{ bypassLimits: true, emitEvents: false },
			);

			expect(deleteMany).toHaveBeenCalledWith(
				['6f1c2a4e-0000-4000-8000-000000000007'],
				{
					bypassLimits: true,
					emitEvents: false,
					keysFromQuery: true,
					userIntegrityCheckFlags: UserIntegrityCheckFlag.All,
				},
			);
		});

		it('deletes nothing for a deleted role holding no access', async () => {
			const deleteMany = vi.spyOn(ItemsService.prototype, 'deleteMany');

			vi.spyOn(ItemsService.prototype, 'getKeysByQuery')
				.mockResolvedValue([]);

			await expect(new AccessService({
				knex: knex.default({ client: MockClient }),
				schema,
			}).deleteRoleAccess(['role-id-7'])).resolves.toStrictEqual([]);

			expect(deleteMany).not.toHaveBeenCalled();
		});

		it('refuses a request deleting a managed access', async () => {
			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);

			tracker.on
				.select('directus_access')
				.response([{
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
					role: null,
					user: 'user-id-7',
					policy: 'policy-id-7',
				}]);

			await expect(new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).deleteMany([
				'6f1c2a4e-0000-4000-8000-000000000001',
				'6f1c2a4e-0000-4000-8000-000000000007',
			])).rejects.toThrow(new InvalidPayloadError({
				reason: 'Access "6f1c2a4e-0000-4000-8000-000000000007" is managed by'
					+ ' "@scalabus/subscriptions", which alone changes it',
			}));

			expect(tracker.history.select).toMatchObject([
				{
					sql: 'select "id", "managed_by", "role", "user", "policy"'
						+ ' from "directus_access"'
						+ ' where "id" in (?, ?) and "managed_by" is not null',
					bindings: [
						'6f1c2a4e-0000-4000-8000-000000000001',
						'6f1c2a4e-0000-4000-8000-000000000007',
					],
				},
			]);
		});

		// Checked before the managed read, whose uuid cast would otherwise
		// fail in the database instead.
		it('refuses a request deleting an access by a key not a uuid', async () => {
			await expect(new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: knex.default({ client: MockClient }),
				schema,
			}).deleteMany(['access-id-1'])).rejects.toThrow(new InvalidPayloadError({
				reason: 'Primary key of directus_access must be a uuid instead of'
					+ ' "access-id-1"',
			}));
		});

		it('lets a request delete an access no extension manages', async () => {
			const deleteMany = vi.spyOn(ItemsService.prototype, 'deleteMany')
				.mockResolvedValue(['6f1c2a4e-0000-4000-8000-000000000001']);

			const database = knex.default({ client: MockClient });

			createTracker(database).on
				.select('directus_access')
				.response([]);

			await expect(new AccessService({
				accountability: {
					admin: true,
					app: true,
					ip: null,
					role: null,
					roles: [],
					user: 'admin-id-1',
				},
				knex: database,
				schema,
			}).deleteMany(['6f1c2a4e-0000-4000-8000-000000000001']))
				.resolves.toStrictEqual(['6f1c2a4e-0000-4000-8000-000000000001']);

			expect(deleteMany).toHaveBeenCalledWith(
				['6f1c2a4e-0000-4000-8000-000000000001'],
				{ userIntegrityCheckFlags: UserIntegrityCheckFlag.All },
			);
		});
	});
});
