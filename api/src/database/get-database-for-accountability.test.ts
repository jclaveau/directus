import type { Accountability } from '@directus/types';
import { beforeEach, expect, test, vi } from 'vitest';

const { mockEnv, knexInstances, mockKnexFactory } = vi.hoisted(() => {
	const knexInstances: any[] = [];

	const mockKnexFactory = vi.fn((config: any) => {
		const instance: any = {
			__knexConfig: config,
			client: { constructor: { name: 'Client_PG' } },
			on: vi.fn(() => instance),
		};

		knexInstances.push(instance);
		return instance;
	});

	return { mockEnv: {} as Record<string, any>, knexInstances, mockKnexFactory };
});

vi.mock('@directus/env', () => ({ useEnv: () => mockEnv }));
vi.mock('knex', () => ({ default: { default: mockKnexFactory } }));

vi.mock('../logger/index.js', () => {
	return {
		useLogger: () => {
			return {
				warn: vi.fn(),
				error: vi.fn(),
				info: vi.fn(),
				debug: vi.fn(),
				trace: vi.fn(),
			};
		},
	};
});

vi.mock('../metrics/index.js', () => ({ useMetrics: () => undefined }));

/** DB name the returned (mocked) knex instance was built for. */
function connectedDatabaseOf(db: any): string {
	return db.__knexConfig.connection.database;
}

beforeEach(() => {
	vi.resetModules();
	knexInstances.length = 0;

	for (const key of Object.keys(mockEnv)) {
		delete mockEnv[key];
	}

	Object.assign(mockEnv, {
		DB_CLIENT: 'pg',
		DB_HOST: 'localhost',
		DB_PORT: 5432,
		DB_DATABASE: 'directus',
		DB_USER: 'u',
		DB_PASSWORD: 'p',
		DB_CONNECTIONS: ['premium_pool'],
		DB_CONNECTION_PREMIUM_POOL_DATABASE: 'directus_premium',
		DB_CONNECTION_PREMIUM_POOL_PRIORITY: 100,
	});
});

test('Routes to the highest-priority granted connection', async () => {
	const { getDatabaseForAccountability } = await import('./index.js');

	const acc = { dbConnections: ['premium_pool'] } as Accountability;
	const db = getDatabaseForAccountability(acc);

	expect(connectedDatabaseOf(db)).toBe('directus_premium');
});

test('Picks the higher priority regardless of grant order', async () => {
	mockEnv['DB_CONNECTIONS'] = ['premium_pool', 'replica_a'];
	mockEnv['DB_CONNECTION_REPLICA_A_DATABASE'] = 'directus_replica';
	mockEnv['DB_CONNECTION_REPLICA_A_PRIORITY'] = 10;

	const { getDatabaseForAccountability } = await import('./index.js');

	// replica_a (10) listed first is a decoy for the higher premium_pool (100)
	const acc = { dbConnections: ['replica_a', 'premium_pool'] } as Accountability;
	const db = getDatabaseForAccountability(acc);

	expect(connectedDatabaseOf(db)).toBe('directus_premium');
});

test('Falls back to the default pool when nothing is granted', async () => {
	const { getDatabaseForAccountability } = await import('./index.js');

	const acc = { dbConnections: [] as string[] } as Accountability;
	expect(connectedDatabaseOf(getDatabaseForAccountability(acc))).toBe('directus');
	expect(connectedDatabaseOf(getDatabaseForAccountability(null))).toBe('directus');
});

test('Falls back when the granted connection is not configured', async () => {
	const { getDatabaseForAccountability } = await import('./index.js');

	const acc = { dbConnections: ['ghost_pool'] } as Accountability;
	const db = getDatabaseForAccountability(acc);

	expect(connectedDatabaseOf(db)).toBe('directus');
});

test('Falls back when no granted connection outranks the default', async () => {
	mockEnv['DB_CONNECTION_PREMIUM_POOL_PRIORITY'] = 0;

	const { getDatabaseForAccountability } = await import('./index.js');

	const acc = { dbConnections: ['premium_pool'] } as Accountability;
	const db = getDatabaseForAccountability(acc);

	expect(connectedDatabaseOf(db)).toBe('directus');
});

test('Lets a policy grant the default pool by its configured name', async () => {
	mockEnv['DB_DEFAULT_CONNECTION_NAME'] = 'primary';

	const { getDatabaseForAccountability } = await import('./index.js');

	const acc = { dbConnections: ['primary'] } as Accountability;
	const db = getDatabaseForAccountability(acc);

	expect(connectedDatabaseOf(db)).toBe('directus');
});

test('Default priority can outrank a lower-priority granted pool', async () => {
	mockEnv['DB_DEFAULT_CONNECTION_PRIORITY'] = 50;
	mockEnv['DB_CONNECTIONS'] = ['replica_a'];
	mockEnv['DB_CONNECTION_REPLICA_A_DATABASE'] = 'directus_replica';
	mockEnv['DB_CONNECTION_REPLICA_A_PRIORITY'] = 10;

	const { getDatabaseForAccountability } = await import('./index.js');

	const acc = { dbConnections: ['replica_a'] } as Accountability;
	const db = getDatabaseForAccountability(acc);

	expect(connectedDatabaseOf(db)).toBe('directus');
});
