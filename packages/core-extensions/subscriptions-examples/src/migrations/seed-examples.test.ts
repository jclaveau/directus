import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { seedExamples } from './seed-examples.js';

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
		table.string('icon');
		table.text('description');
		table.boolean('app_access');
		table.boolean('admin_access');
		table.boolean('enforce_tfa');
	});

	await database.schema.createTable('directus_roles', (table) => {
		table.uuid('id').primary();
		table.string('name');
		table.string('icon');
	});

	await database.schema.createTable('directus_access', (table) => {
		table.uuid('id').primary();
		table.uuid('role');
		table.uuid('policy');
	});

	await database.schema.createTable('directus_users', (table) => {
		table.uuid('id').primary();
		table.string('email');
		table.string('password');
		table.uuid('role');
		table.string('status');
		table.string('provider');
	});

	await database.schema.createTable('directus_permissions', (table) => {
		table.increments('id');
		table.uuid('policy');
		table.string('collection');
		table.string('action');
		table.text('fields');
	});

	await database.schema.createTable('subscription_plans', (table) => {
		table.increments('id');
		table.string('code');
		table.string('name');
		table.decimal('amount');
		table.string('currency');
		table.string('interval');
		table.integer('beneficiaries_max');
		table.uuid('policy');
		table.string('status');
	});
});

afterEach(async () => {
	await database.destroy();
});

describe('seedExamples', () => {
	test('seeds the plans, their policy and the tester', async () => {
		await seedExamples.config.up(database);

		expect(await database('directus_policies').orderBy('name')).toEqual([
			{
				id: expect.any(String),
				name: 'Examples member',
				icon: 'card_membership',
				description: 'Granted by the sample plans of the examples',
				app_access: 1,
				admin_access: 0,
				enforce_tfa: 0,
			},
			{
				id: expect.any(String),
				name: 'Examples tester',
				icon: 'science',
				description: 'Opens the examples module and manages its seats',
				app_access: 1,
				admin_access: 0,
				enforce_tfa: 0,
			},
		]);

		expect(await database('directus_roles')).toEqual([
			{ id: expect.any(String), name: 'Examples tester', icon: 'science' },
		]);

		expect(await database('directus_access')).toEqual([
			{
				id: expect.any(String),
				role: expect.any(String),
				policy: expect.any(String),
			},
		]);

		expect(await database('directus_users')).toEqual([
			{
				id: expect.any(String),
				email: 'tester@example.com',
				password: '$argon2id$v=19$m=65536,p=4,t=3'
					+ '$iUI/jN2lJ1phMSz3m3DcKg'
					+ '$4zrok2Vsc7CllyO6CYAN+ZYUpjyz25bSmsbD+sjdLFM',
				role: expect.any(String),
				status: 'active',
				provider: 'default',
			},
		]);

		expect(await database('directus_permissions')
			.select('collection', 'action', 'fields')).toEqual([
			{
				collection: 'subscription_plans',
				action: 'read',
				fields: 'code,name,amount,currency,interval,beneficiaries_max',
			},
			{
				collection: 'subscription_plans',
				action: 'read',
				fields: 'code,name,amount,currency,interval,beneficiaries_max',
			},
			{ collection: 'directus_users', action: 'read', fields: 'id,email' },
			{
				collection: 'subscription_beneficiaries',
				action: 'read',
				fields: 'id,subscription,user',
			},
			{
				collection: 'subscription_beneficiaries',
				action: 'delete',
				fields: '*',
			},
		]);

		expect(await database('subscription_plans')
			.select(
				'code',
				'name',
				'amount',
				'currency',
				'interval',
				'beneficiaries_max',
				'status',
			)).toEqual([
			{
				code: 'basic',
				name: 'Basic',
				amount: 10,
				currency: 'EUR',
				interval: '{"months":1}',
				beneficiaries_max: 1,
				status: 'active',
			},
			{
				code: 'team',
				name: 'Team',
				amount: 25,
				currency: 'EUR',
				interval: '{"months":1}',
				beneficiaries_max: 3,
				status: 'active',
			},
			{
				code: 'yearly',
				name: 'Yearly',
				amount: 100,
				currency: 'EUR',
				interval: '{"months":12}',
				beneficiaries_max: 1,
				status: 'active',
			},
		]);
	});

	test('grants the plans the member policy, the tester the tester one', async () => {
		await seedExamples.config.up(database);

		expect(await database('subscription_plans')
			.join(
				'directus_policies',
				'directus_policies.id',
				'subscription_plans.policy',
			)
			.select('subscription_plans.code', 'directus_policies.name'))
			.toEqual([
				{ code: 'basic', name: 'Examples member' },
				{ code: 'team', name: 'Examples member' },
				{ code: 'yearly', name: 'Examples member' },
			]);

		expect(await database('directus_users')
			.join('directus_access', 'directus_access.role', 'directus_users.role')
			.join('directus_roles', 'directus_roles.id', 'directus_users.role')
			.join(
				'directus_policies',
				'directus_policies.id',
				'directus_access.policy',
			)
			.select(
				'directus_users.email',
				{ role: 'directus_roles.name' },
				{ policy: 'directus_policies.name' },
			))
			.toEqual([{
				email: 'tester@example.com',
				role: 'Examples tester',
				policy: 'Examples tester',
			}]);

		expect(await database('directus_permissions')
			.join(
				'directus_policies',
				'directus_policies.id',
				'directus_permissions.policy',
			)
			.select('directus_policies.name', 'directus_permissions.collection')
			.orderBy('directus_permissions.id'))
			.toEqual([
				{ name: 'Examples member', collection: 'subscription_plans' },
				{ name: 'Examples tester', collection: 'subscription_plans' },
				{ name: 'Examples tester', collection: 'directus_users' },
				{ name: 'Examples tester', collection: 'subscription_beneficiaries' },
				{ name: 'Examples tester', collection: 'subscription_beneficiaries' },
			]);
	});

	test('removes what it seeded and keeps the rest', async () => {
		await database('directus_policies')
			.insert({ id: 'policy-kept', name: 'Editors' });

		await database('directus_roles').insert({ id: 'role-kept', name: 'Editor' });

		await database('directus_access')
			.insert({ id: 'access-kept', role: 'role-kept', policy: 'policy-kept' });

		await database('directus_users')
			.insert({ id: 'user-kept', email: 'editor@example.com' });

		await database('directus_permissions').insert({
			policy: 'policy-kept',
			collection: 'articles',
			action: 'read',
		});

		await database('subscription_plans')
			.insert({ code: 'pro', name: 'Pro', policy: 'policy-kept' });

		await seedExamples.config.up(database);
		await seedExamples.config.down(database);

		expect({
			policies: await database('directus_policies').pluck('id'),
			roles: await database('directus_roles').pluck('id'),
			accesses: await database('directus_access').pluck('id'),
			users: await database('directus_users').pluck('id'),
			permissions: await database('directus_permissions').pluck('collection'),
			plans: await database('subscription_plans').pluck('code'),
		}).toEqual({
			policies: ['policy-kept'],
			roles: ['role-kept'],
			accesses: ['access-kept'],
			users: ['user-kept'],
			permissions: ['articles'],
			plans: ['pro'],
		});
	});
});
