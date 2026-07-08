import { beforeEach, expect, test, vi } from 'vitest';
import {
	createDefaultAccountability,
} from '../permissions/utils/create-default-accountability.js';

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
		DB_CONNECTIONS: ['premium'],
		DB_CONNECTION_PREMIUM_DATABASE: 'directus_premium',
		DB_CONNECTION_PREMIUM_PRIORITY: 100,
	});
});

test('Uses the highest-priority granted connection', async () => {
	const { getDatabaseForAccountability } = await import('./index.js');

	const acc = createDefaultAccountability({ grantedDbConnections: ['premium'] });
	const db = getDatabaseForAccountability(acc);

	expect(connectedDatabaseOf(db)).toBe('directus_premium');
	// second call returns the cached instance, not a freshly built one
	expect(getDatabaseForAccountability(acc)).toBe(db);
});

test('Refuses to build when a connection name is duplicated', async () => {
	mockEnv['DB_CONNECTIONS'] = ['dupe', 'dupe'];

	const { default: getDatabase } = await import('./index.js');

	expect(() => getDatabase()).toThrow(/Duplicate DB connection name/);
});

test('Refuses to build when a connection name equals the default name', async () => {
	mockEnv['DB_DEFAULT_CONNECTION_NAME'] = 'shared';
	mockEnv['DB_CONNECTIONS'] = ['shared'];

	const { default: getDatabase } = await import('./index.js');

	expect(() => getDatabase()).toThrow(/Duplicate DB connection name/);
});

test('Reads DB_CONNECTIONS as a CSV string (e.g. when set at runtime)', async () => {
	mockEnv['DB_CONNECTIONS'] = 'premium, replica_a';
	mockEnv['DB_CONNECTION_REPLICA_A_DATABASE'] = 'directus_replica';
	mockEnv['DB_CONNECTION_REPLICA_A_PRIORITY'] = 10;

	const { getDatabaseForAccountability } = await import('./index.js');

	expect(
		connectedDatabaseOf(
			getDatabaseForAccountability(
				createDefaultAccountability({
					grantedDbConnections: ['replica_a', 'premium'],
				}),
			),
		),
	).toBe('directus_premium');
});

test('Picks the higher priority regardless of grant order', async () => {
	mockEnv['DB_CONNECTIONS'] = ['premium', 'replica_a'];
	mockEnv['DB_CONNECTION_REPLICA_A_DATABASE'] = 'directus_replica';
	mockEnv['DB_CONNECTION_REPLICA_A_PRIORITY'] = 10;

	const { getDatabaseForAccountability } = await import('./index.js');

	// replica_a (10) listed first is a decoy for the higher premium (100)
	expect(
		connectedDatabaseOf(
			getDatabaseForAccountability(
				createDefaultAccountability({
					grantedDbConnections: ['replica_a', 'premium'],
				}),
			),
		),
	).toBe('directus_premium');
});

test('Falls back to the default pool when nothing is granted', async () => {
	const { getDatabaseForAccountability } = await import('./index.js');

	const acc = createDefaultAccountability({ grantedDbConnections: [] });
	expect(connectedDatabaseOf(getDatabaseForAccountability(acc))).toBe('directus');
	expect(connectedDatabaseOf(getDatabaseForAccountability(null))).toBe('directus');
});

test('A share token (no granted connections) uses the default pool', async () => {
	const { getDatabaseForAccountability } = await import('./index.js');

	// A share-token accountability never runs global-access, so grantedDbConnections
	// is undefined — it must resolve to the default pool, not throw or misroute.
	const acc = createDefaultAccountability({ share: 'a-share-id' });
	expect(connectedDatabaseOf(getDatabaseForAccountability(acc))).toBe('directus');
});

test('Falls back when the granted connection is not configured', async () => {
	const { getDatabaseForAccountability } = await import('./index.js');

	expect(
		connectedDatabaseOf(
			getDatabaseForAccountability(
				createDefaultAccountability({ grantedDbConnections: ['ghost_pool'] }),
			),
		),
	).toBe('directus');
});

test('Falls back when no granted connection outranks the default', async () => {
	mockEnv['DB_CONNECTION_PREMIUM_PRIORITY'] = 0;

	const { getDatabaseForAccountability } = await import('./index.js');

	expect(
		connectedDatabaseOf(
			getDatabaseForAccountability(
				createDefaultAccountability({ grantedDbConnections: ['premium'] }),
			),
		),
	).toBe('directus');
});

test('Lets a policy grant the default pool by its configured name', async () => {
	mockEnv['DB_DEFAULT_CONNECTION_NAME'] = 'primary';

	const { getDatabaseForAccountability } = await import('./index.js');

	expect(
		connectedDatabaseOf(
			getDatabaseForAccountability(
				createDefaultAccountability({ grantedDbConnections: ['primary'] }),
			),
		),
	).toBe('directus');
});

test('Default priority can outrank a lower-priority granted pool', async () => {
	mockEnv['DB_DEFAULT_CONNECTION_PRIORITY'] = 50;
	mockEnv['DB_CONNECTIONS'] = ['replica_a'];
	mockEnv['DB_CONNECTION_REPLICA_A_DATABASE'] = 'directus_replica';
	mockEnv['DB_CONNECTION_REPLICA_A_PRIORITY'] = 10;

	const { getDatabaseForAccountability } = await import('./index.js');

	expect(
		connectedDatabaseOf(
			getDatabaseForAccountability(
				createDefaultAccountability({ grantedDbConnections: ['replica_a'] }),
			),
		),
	).toBe('directus');
});
