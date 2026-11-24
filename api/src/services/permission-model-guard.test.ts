import { ForbiddenError } from '@directus/errors';
import { SchemaBuilder } from '@directus/schema-builder';
import type { AbstractServiceOptions, Accountability } from '@directus/types';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { describe, expect, it, vi } from 'vitest';
import { AccessService } from './access.js';
import type { ItemsService } from './items.js';
import { PermissionsService } from './permissions.js';
import { PoliciesService } from './policies.js';
import { RolesService } from './roles.js';
import { UsersService } from './users.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

const schema = new SchemaBuilder()
	.collection('directus_roles', (c) => {
		c.field('id').uuid()
			.primary();
	})
	.build();

const nonAdmin = {
	admin: false,
	app: false,
	ip: null,
	role: 'role-id-1',
	roles: ['role-id-1'],
	user: 'user-id-1',
} as Accountability;

const admin = { ...nonAdmin, admin: true } as Accountability;

function guardedService(
	ServiceClass: new (options: AbstractServiceOptions) => ItemsService,
	accountability: Accountability | null,
) {
	return new ServiceClass({
		accountability,
		knex: knex.default({ client: MockClient }),
		schema,
	});
}

describe('the permission model guard', () => {
	describe.each([
		['access', AccessService],
		['policies', PoliciesService],
		['permissions', PermissionsService],
	])('on %s', (_collectionName, ServiceClass) => {
		it('refuses a non-admin any create, update and delete', async () => {
			const service = guardedService(ServiceClass, nonAdmin);
			const database = knex.default({ client: MockClient });

			await expect(service['validateRowsToCreate']([{}], database))
				.rejects.toThrow(new ForbiddenError());

			await expect(service['validateGroupsToUpdate'](
				[{ keys: ['key-1'], data: {} }],
				database,
			)).rejects.toThrow(new ForbiddenError());

			await expect(service['validateKeysToDelete'](['key-1'], {}, database))
				.rejects.toThrow(new ForbiddenError());
		});
	});

	it.each([
		['an admin', admin],
		['code, with no accountability', null],
	])('lets %s create and delete policies', async (_name, accountability) => {
		const service = guardedService(PoliciesService, accountability);
		const database = knex.default({ client: MockClient });

		await expect(service['validateRowsToCreate']([{}], database))
			.resolves.toBeUndefined();

		await expect(service['validateKeysToDelete'](['key-1'], {}, database))
			.resolves.toBeUndefined();
	});

	describe.each([
		['roles', RolesService, 'parent'],
		['users', UsersService, 'role'],
	])('on %s', (_collectionName, ServiceClass, modelField) => {
		const database = knex.default({ client: MockClient });

		it(`refuses a non-admin a ${modelField} on create or update`, async () => {
			const service = guardedService(ServiceClass, nonAdmin);

			await expect(service['validateRowsToCreate'](
				[{ [modelField]: 'role-id-2' }],
				database,
			)).rejects.toThrow(new ForbiddenError());

			await expect(service['validateGroupsToUpdate'](
				[{ keys: ['key-1'], data: { [modelField]: null } }],
				database,
			)).rejects.toThrow(new ForbiddenError());
		});

		it(`lets a non-admin write rows with no ${modelField}`, async () => {
			const service = guardedService(ServiceClass, nonAdmin);

			await expect(service['validateRowsToCreate'](
				[{ name: 'renamed' }, { [modelField]: null }],
				database,
			)).resolves.toBeUndefined();

			await expect(service['validateGroupsToUpdate'](
				[{ keys: ['key-1'], data: { name: 'renamed' } }],
				database,
			)).resolves.toBeUndefined();
		});

		it(`lets an admin set a ${modelField}`, async () => {
			const service = guardedService(ServiceClass, admin);

			await expect(service['validateRowsToCreate'](
				[{ [modelField]: 'role-id-2' }],
				database,
			)).resolves.toBeUndefined();

			await expect(service['validateGroupsToUpdate'](
				[{ keys: ['key-1'], data: { [modelField]: 'role-id-2' } }],
				database,
			)).resolves.toBeUndefined();
		});
	});
});
