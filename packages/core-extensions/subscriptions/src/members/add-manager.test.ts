import knex, { type Knex } from 'knex';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
	createSubscriptionTables,
} from '../migrations/create-subscription-tables.js';
import { addManager } from './add-manager.js';

let database: Knex;

beforeEach(async () => {
	database = knex({
		client: 'sqlite3',
		connection: { filename: ':memory:' },
		useNullAsDefault: true,
		pool: { min: 1, max: 1 },
	});

	await createSubscriptionTables.config.up(database);
});

afterEach(async () => {
	await database.destroy();
});

describe('addManager', () => {
	test('stores the manager row', async () => {
		expect(await addManager(database, { subscription: 1, user: 'user-1' }))
			.toBe(1);

		expect(await database('subscription_managers'))
			.toEqual([{ id: 1, subscription: 1, user: 'user-1' }]);
	});
});
