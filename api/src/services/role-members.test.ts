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
});
