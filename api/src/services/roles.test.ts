import { SchemaBuilder } from '@directus/schema-builder';
import type { MutationOptions } from '@directus/types';
import { UserIntegrityCheckFlag } from '@directus/types';
import knex from 'knex';
import { MockClient, createTracker } from 'knex-mock-client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import emitter from '../emitter.js';
import { AccessService, ItemsService, PresetsService, RolesService, UsersService } from './index.js';

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').uuid().primary();
	})
	.collection('directus_roles', (c) => {
		c.field('id').uuid()
			.primary();

		c.field('name').string();
		c.field('parent').uuid();
	})
	.build();

// Taken before the updateMany tests replace them on the prototypes.
const validateRoleNesting = (RolesService.prototype as any).validateRoleNesting;
const itemsUpdateGroups = ItemsService.prototype.updateGroups;

describe('Integration Tests', () => {
	const db = knex.default({ client: MockClient });
	const tracker = createTracker(db);

	describe('Services / Roles', () => {
		const service = new RolesService({
			knex: db,
			schema,
		});

		afterEach(() => {
			vi.clearAllMocks();
		});

		describe('updateMany', () => {
			const superUpdateGroupsSpy = vi.spyOn(ItemsService.prototype, 'updateGroups')
				.mockResolvedValue(['role-id-1']);

			const validateRoleNestingSpy = vi
				.spyOn(RolesService.prototype as any, 'validateRoleNesting')
				.mockImplementation(vi.fn());

			it('should not request user integrity checks if no relevant fields are changed', async () => {
				const opts: MutationOptions = {};

				await service.updateMany(['role-id-2'], {}, opts);

				expect(opts.userIntegrityCheckFlags).toBe(undefined);
			});

			it('should request all user integrity checks if parent is changed', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_roles').response(1);

				const onRequireUserIntegrityCheck = vi.fn();

				await service.updateMany(
					['5a1c9e20-3b4d-4c6e-8f70-000000000003'],
					{ parent: '5a1c9e20-3b4d-4c6e-8f70-000000000103' },
					{ onRequireUserIntegrityCheck },
				);

				expect(onRequireUserIntegrityCheck)
					.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);
			});

			it('should validate role nesting if parent is changed', async () => {
				const opts: MutationOptions = {};

				await service.updateMany(['role-id-4'], { parent: 'parent-role-id-2' }, opts);

				expect(validateRoleNestingSpy).toHaveBeenCalled();
			});

			it('should clear caches if parent is changed', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_roles').response(1);

				const clearCacheSpy = vi.spyOn(RolesService.prototype as any, 'clearCaches');

				await service.updateMany(
					['5a1c9e20-3b4d-4c6e-8f70-000000000005'],
					{ parent: '5a1c9e20-3b4d-4c6e-8f70-000000000105' },
					{ onRequireUserIntegrityCheck: vi.fn() },
				);

				expect(clearCacheSpy).toHaveBeenCalled();
			});

			it('clears the caches when a roles.update hook reparents', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_roles').response(1);

				const clearCacheSpy = vi.spyOn(RolesService.prototype as any, 'clearCaches');
				const onRequireUserIntegrityCheck = vi.fn();

				const giveParent = () => {
					return [{
						data: {
							name: 'Editors',
							parent: '5a1c9e20-3b4d-4c6e-8f70-000000000111',
						},
						keys: ['5a1c9e20-3b4d-4c6e-8f70-000000000011'],
					}];
				};

				emitter.onFilter('roles.update', giveParent);

				try {
					await service.updateMany(
						['5a1c9e20-3b4d-4c6e-8f70-000000000011'],
						{ name: 'Editors' },
						{ onRequireUserIntegrityCheck },
					);
				}
				finally {
					emitter.offFilter('roles.update', giveParent);
				}

				expect(onRequireUserIntegrityCheck)
					.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);

				expect(clearCacheSpy).toHaveBeenCalled();
			});

			it('validates the nesting of every row of a batch', async () => {
				superUpdateGroupsSpy.mockImplementationOnce(itemsUpdateGroups);
				tracker.on.update('directus_roles').response(1);

				const onRequireUserIntegrityCheck = vi.fn();

				await service.updateBatch([
					{
						id: '5a1c9e20-3b4d-4c6e-8f70-000000000009',
						parent: '5a1c9e20-3b4d-4c6e-8f70-000000000104',
					},
					{
						id: '5a1c9e20-3b4d-4c6e-8f70-000000000010',
						parent: '5a1c9e20-3b4d-4c6e-8f70-000000000105',
					},
				], { onRequireUserIntegrityCheck });

				expect(validateRoleNestingSpy).toHaveBeenCalledWith([
					{
						data: { parent: '5a1c9e20-3b4d-4c6e-8f70-000000000104' },
						keys: ['5a1c9e20-3b4d-4c6e-8f70-000000000009'],
					},
					{
						data: { parent: '5a1c9e20-3b4d-4c6e-8f70-000000000105' },
						keys: ['5a1c9e20-3b4d-4c6e-8f70-000000000010'],
					},
				]);

				expect(onRequireUserIntegrityCheck)
					.toHaveBeenCalledWith(UserIntegrityCheckFlag.All);
			});
		});

		describe('deleteMany', () => {
			db.isTransaction = false;

			const accessDeleteByQuerySpy = vi
				.spyOn(AccessService.prototype, 'deleteByQuery')
				.mockResolvedValue(['access-id-1']);

			const presetsDeleteByQuerySpy = vi
				.spyOn(PresetsService.prototype, 'deleteByQuery')
				.mockResolvedValue(['preset-id-1']);

			const usersUpdateByQuerySpy = vi.spyOn(UsersService.prototype, 'updateByQuery').mockResolvedValue(['user-id-1']);
			const rolesUpdateByQuerySpy = vi.spyOn(RolesService.prototype, 'updateByQuery').mockResolvedValue(['role-id-6']);
			const itemsDeleteManySpy = vi.spyOn(ItemsService.prototype, 'deleteMany').mockResolvedValue(['item-id-1']);

			it('should call associated service methods, with user integrity check flag', async () => {
				const keys = ['role-id-7'];

				await service.deleteMany(keys);

				const opts: MutationOptions = { userIntegrityCheckFlags: UserIntegrityCheckFlag.All, bypassLimits: true };

				expect(accessDeleteByQuerySpy).toHaveBeenCalledWith(
					{
						filter: { role: { _in: keys } },
					},
					opts,
				);

				expect(presetsDeleteByQuerySpy).toHaveBeenCalledWith(
					{
						filter: { role: { _in: keys } },
					},
					opts,
				);

				expect(presetsDeleteByQuerySpy).toHaveBeenCalledWith(
					{
						filter: { role: { _in: keys } },
					},
					opts,
				);

				expect(usersUpdateByQuerySpy).toHaveBeenCalledWith(
					{
						filter: { role: { _in: keys } },
					},
					{
						status: 'suspended',
						role: null,
					},
					opts,
				);

				expect(rolesUpdateByQuerySpy).toHaveBeenCalledWith(
					{
						filter: { parent: { _in: keys } },
					},
					{ parent: null },
				);

				expect(itemsDeleteManySpy).toHaveBeenCalledWith(keys, { userIntegrityCheckFlags: UserIntegrityCheckFlag.All });
			});

			it('should clear caches', async () => {
				const clearCacheSpy = vi.spyOn(RolesService.prototype as any, 'clearCaches');

				await service.deleteMany(['role-id-8']);

				expect(clearCacheSpy).toHaveBeenCalled();
			});
		});

		describe('validateRoleNesting', () => {
			afterEach(() => {
				tracker.reset();
			});

			it('refuses a role made its own parent', async () => {
				await expect(validateRoleNesting.call(service, [
					{ data: { parent: 'role-a' }, keys: ['role-a'] },
				])).rejects.toThrow('A role cannot be a parent of itself');
			});

			it('refuses a parent stored below the role', async () => {
				tracker.on.select('directus_roles')
					.responseOnce({ parent: 'role-a' });

				await expect(validateRoleNesting.call(service, [
					{ data: { parent: 'role-b' }, keys: ['role-a'] },
				])).rejects.toThrow('already a descendant of itself');
			});

			it('refuses two rows of a batch putting roles under each other', async () => {
				tracker.on.select('directus_roles').response({ parent: null });

				await expect(validateRoleNesting.call(service, [
					{ data: { parent: 'role-b' }, keys: ['role-a'] },
					{ data: { parent: 'role-a' }, keys: ['role-b'] },
				])).rejects.toThrow('already a descendant of itself');
			});

			it('accepts a batch freeing the child the role moves under', async () => {
				tracker.on.select('directus_roles').response({ parent: 'role-a' });

				await expect(validateRoleNesting.call(service, [
					{ data: { parent: 'role-b' }, keys: ['role-a'] },
					{ data: { parent: null }, keys: ['role-b'] },
				])).resolves.toBe(undefined);
			});

			it('stops at a stored loop the role is not part of', async () => {
				tracker.on.select('directus_roles').responseOnce({ parent: 'role-c' });
				tracker.on.select('directus_roles').responseOnce({ parent: 'role-b' });

				await expect(validateRoleNesting.call(service, [
					{ data: { parent: 'role-b' }, keys: ['role-a'] },
				])).resolves.toBe(undefined);

				expect(tracker.history.select).toHaveLength(2);
			});

			it('refuses a role made its own parent in another casing', async () => {
				tracker.on.select('directus_roles').response({ parent: null });

				await expect(validateRoleNesting.call(service, [
					{ data: { parent: 'ROLE-A' }, keys: ['role-a'] },
				])).rejects.toThrow('A role cannot be a parent of itself');
			});

			it('refuses a batch loop naming one role in two casings', async () => {
				tracker.on.select('directus_roles').response({ parent: null });

				await expect(validateRoleNesting.call(service, [
					{ data: { parent: 'ROLE-B' }, keys: ['role-a'] },
					{ data: { parent: 'role-a' }, keys: ['role-b'] },
				])).rejects.toThrow('already a descendant of itself');
			});
		});
	});
});
