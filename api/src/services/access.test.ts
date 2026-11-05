import { InvalidPayloadError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import { UserIntegrityCheckFlag } from '@directus/types';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearSystemCache } from '../cache.js';
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
			}).updateOne('6f1c2a4e-0000-4000-8000-000000000001', {
				managed_by: '@scalabus/subscriptions',
			})).rejects.toThrow(new InvalidPayloadError({
				reason: '"managed_by" is set by the extension granting the access,'
					+ ' not by a request',
			}));
		});

		it('refuses a request updating a managed access', async () => {
			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);

			tracker.on
				.select('directus_access')
				.response({
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
				});

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
					sql: 'select "id", "managed_by" from "directus_access"'
						+ ' where "id" in (?) and "managed_by" is not null limit ?',
					bindings: ['6f1c2a4e-0000-4000-8000-000000000007', 1],
				},
			]);
		});

		it('refuses a request deleting a managed access', async () => {
			const database = knex.default({ client: MockClient });
			const tracker = createTracker(database);

			tracker.on
				.select('directus_access')
				.response({
					id: '6f1c2a4e-0000-4000-8000-000000000007',
					managed_by: '@scalabus/subscriptions',
				});

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
					sql: 'select "id", "managed_by" from "directus_access"'
						+ ' where "id" in (?, ?) and "managed_by" is not null limit ?',
					bindings: [
						'6f1c2a4e-0000-4000-8000-000000000001',
						'6f1c2a4e-0000-4000-8000-000000000007',
						1,
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
				.response(undefined);

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
