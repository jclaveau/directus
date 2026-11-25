import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { down, up } from './20261124A-warn-on-non-admin-permission-model-writes.js';

const migrationLogger = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../logger/index.js', () => ({ useLogger: () => migrationLogger }));

describe('warning on non-admin permission model writes', () => {
	let database: Knex;

	beforeEach(async () => {
		database = knex({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
			pool: { min: 1, max: 1 },
		});

		await database.schema.createTable('directus_policies', (table) => {
			table.uuid('id').primary();
			table.string('name');
			table.boolean('admin_access');
		});

		await database.schema.createTable('directus_permissions', (table) => {
			table.increments('id');
			table.string('collection');
			table.string('action');
			table.text('fields');
			table.uuid('policy');
		});

		await database('directus_policies').insert([
			{
				id: 'p-managers',
				name: 'Managers',
				admin_access: false,
			},
			{
				id: 'p-admins',
				name: 'Admins',
				admin_access: true,
			},
		]);
	});

	afterEach(async () => {
		await database.destroy();
		vi.restoreAllMocks();
		migrationLogger.warn.mockReset();
	});

	it('names each permission model write a non-admin policy holds', async () => {
		await database('directus_permissions').insert([
			{
				collection: 'directus_access',
				action: 'create',
				fields: '*',
				policy: 'p-managers',
			},
			{
				collection: 'directus_policies',
				action: 'delete',
				fields: null,
				policy: 'p-managers',
			},
			{
				collection: 'directus_permissions',
				action: 'update',
				fields: 'fields',
				policy: 'p-managers',
			},
			{
				collection: 'directus_users',
				action: 'update',
				fields: 'first_name,role',
				policy: 'p-managers',
			},
			{
				collection: 'directus_roles',
				action: 'create',
				fields: '*',
				policy: 'p-managers',
			},
		]);

		await up(database);

		expect(migrationLogger.warn.mock.calls).toEqual([
			[
				'Permission 1 of policy "Managers" (p-managers): create'
				+ ' on directus_access is refused to non-admins from now on',
			],
			[
				'Permission 2 of policy "Managers" (p-managers): delete'
				+ ' on directus_policies is refused to non-admins from now on',
			],
			[
				'Permission 3 of policy "Managers" (p-managers): update'
				+ ' on directus_permissions is refused to non-admins from now on',
			],
			[
				'Permission 4 of policy "Managers" (p-managers): update'
				+ ' on directus_users.role is refused to non-admins from now on',
			],
			[
				'Permission 5 of policy "Managers" (p-managers): create'
				+ ' on directus_roles.parent is refused to non-admins from now on',
			],
		]);
	});

	it('names no permission the guard leaves open', async () => {
		await database('directus_permissions').insert([
			{
				collection: 'directus_access',
				action: 'read',
				fields: '*',
				policy: 'p-managers',
			},
			{
				collection: 'directus_access',
				action: 'create',
				fields: '*',
				policy: 'p-admins',
			},
			{
				collection: 'directus_users',
				action: 'update',
				fields: 'first_name',
				policy: 'p-managers',
			},
			{
				collection: 'directus_users',
				action: 'update',
				fields: null,
				policy: 'p-managers',
			},
			{
				collection: 'directus_roles',
				action: 'delete',
				fields: '*',
				policy: 'p-managers',
			},
			{
				collection: 'articles',
				action: 'create',
				fields: '*',
				policy: 'p-managers',
			},
		]);

		await up(database);

		expect(migrationLogger.warn).not.toHaveBeenCalled();
	});

	it('changes nothing on the way down', async () => {
		await expect(down()).resolves.toBeUndefined();
	});
});
