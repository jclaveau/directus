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

vi.mock('../utils/node-id.js', () => ({ nodeId: 'testnode' }));

function connectedDatabaseOf(db: any): string {
	return db.__knexConfig.connection.database;
}

function applicationNameOf(db: any): string | undefined {
	return db.__knexConfig.connection.application_name;
}

function connectionStringOf(db: any): string {
	return db.__knexConfig.connection;
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

test('Refuses to build when a connection name equals the base name', async () => {
	mockEnv['DB_BASE_CONNECTION_NAME'] = 'shared';
	mockEnv['DB_CONNECTIONS'] = ['shared'];

	const { default: getDatabase } = await import('./index.js');

	expect(() => getDatabase()).toThrow(/Duplicate DB connection name/);
});

test('Refuses to build a named connection missing a field', async () => {
	// analytics overrides the client to sqlite3 but sets no filename; the base
	// pg host/port/database it inherits are meaningless for sqlite → fail boot.
	mockEnv['DB_CONNECTIONS'] = ['analytics'];
	mockEnv['DB_CONNECTION_ANALYTICS_CLIENT'] = 'sqlite3';

	const { default: getDatabase } = await import('./index.js');

	expect(() => getDatabase()).toThrow(/missing "filename"/);
});

test('Builds when a named connection only overrides the database', async () => {
	// premium (from beforeEach) inherits the base pg client/host/port/user and
	// overrides only the database → a complete config, so boot does not throw.
	const { default: getDatabase } = await import('./index.js');

	expect(() => getDatabase()).not.toThrow();
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

test('Falls back to the base pool when nothing is granted', async () => {
	const { getDatabaseForAccountability } = await import('./index.js');

	const acc = createDefaultAccountability({ grantedDbConnections: [] });
	expect(connectedDatabaseOf(getDatabaseForAccountability(acc))).toBe('directus');
	expect(connectedDatabaseOf(getDatabaseForAccountability(null))).toBe('directus');
});

test('A share token (no granted connections) uses the base pool', async () => {
	const { getDatabaseForAccountability } = await import('./index.js');

	// A share-token accountability never runs global-access, so grantedDbConnections
	// is undefined — it must resolve to the base pool, not throw or misroute.
	const acc = createDefaultAccountability({ share: 'a-share-id' });
	expect(connectedDatabaseOf(getDatabaseForAccountability(acc))).toBe('directus');
});

test('A public share routes to the configured share pool', async () => {
	mockEnv['DB_PUBLIC_SHARE_CONNECTION_NAME'] = 'premium';

	const { getDatabaseForAccountability } = await import('./index.js');

	// A share lands on the dedicated share pool, off the base pool …
	const share = createDefaultAccountability({ share: 'a-share-id' });

	expect(connectedDatabaseOf(getDatabaseForAccountability(share))).toBe(
		'directus_premium',
	);

	// … while a non-share request is unaffected (the override is share-gated).
	const authed = createDefaultAccountability({});
	expect(connectedDatabaseOf(getDatabaseForAccountability(authed))).toBe('directus');
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

test('A granted connection at equal priority outranks the base pool', async () => {
	// premium (0) ties the base pool (0); the base pool is the floor, so the
	// grant wins the tie rather than falling back.
	mockEnv['DB_CONNECTION_PREMIUM_PRIORITY'] = 0;

	const { getDatabaseForAccountability } = await import('./index.js');

	expect(
		connectedDatabaseOf(
			getDatabaseForAccountability(
				createDefaultAccountability({ grantedDbConnections: ['premium'] }),
			),
		),
	).toBe('directus_premium');
});

test('Two grants tied at base priority break by name, base excluded', async () => {
	mockEnv['DB_CONNECTIONS'] = ['premium', 'replica_a'];
	mockEnv['DB_CONNECTION_PREMIUM_PRIORITY'] = 0;
	mockEnv['DB_CONNECTION_REPLICA_A_DATABASE'] = 'directus_replica';
	mockEnv['DB_CONNECTION_REPLICA_A_PRIORITY'] = 0;

	const { getDatabaseForAccountability } = await import('./index.js');

	// premium, replica_a and the base pool all tie at 0; base is the floor, and
	// premium < replica_a by name, so premium wins.
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

test('Lets a policy grant the base pool by its configured name', async () => {
	mockEnv['DB_BASE_CONNECTION_NAME'] = 'primary';

	const { getDatabaseForAccountability } = await import('./index.js');

	expect(
		connectedDatabaseOf(
			getDatabaseForAccountability(
				createDefaultAccountability({ grantedDbConnections: ['primary'] }),
			),
		),
	).toBe('directus');
});

test('Every pool announces which pool it is', async () => {
	const { default: getDatabase, getDatabaseForAccountability } =
		await import('./index.js');

	expect(applicationNameOf(getDatabase())).toBe('directus:testnode:base');

	// pgbouncer prints this per client, so a connection is traceable back to the
	// process and the pool it came from without guessing from an address.
	expect(
		applicationNameOf(
			getDatabaseForAccountability(
				createDefaultAccountability({ grantedDbConnections: ['premium'] }),
			),
		),
	).toBe('directus:testnode:premium');
});

test('A configured application name wins, under the driver\'s own key', async () => {
	mockEnv['DB_APPLICATION_NAME'] = 'reporting';

	const { default: getDatabase } = await import('./index.js');

	expect(applicationNameOf(getDatabase())).toBe('reporting');
});

test('A pool that cannot carry the parameter is not given one', async () => {
	// sqlite has no such connection parameter, and a connection string carries
	// its own — neither takes the stamp.
	mockEnv['DB_CLIENT'] = 'sqlite3';
	mockEnv['DB_FILENAME'] = './data.db';

	const { default: getDatabase } = await import('./index.js');

	expect(applicationNameOf(getDatabase())).toBeUndefined();
});

test('A pool built from a connection string keeps the string', async () => {
	mockEnv['DB_CONNECTION_STRING'] = 'postgres://u:p@localhost:5432/directus';

	const { default: getDatabase } = await import('./index.js');

	expect(connectionStringOf(getDatabase()))
		.toBe('postgres://u:p@localhost:5432/directus');
});

test('Base priority can outrank a lower-priority granted pool', async () => {
	mockEnv['DB_BASE_CONNECTION_PRIORITY'] = 50;
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
