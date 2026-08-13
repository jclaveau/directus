import { afterEach, expect, test, vi } from 'vitest';
import { type AdminRow, showPgBouncer } from './admin-console.js';
import {
	buildClients,
	buildLimits,
	buildPools,
	buildServers,
	buildStats,
	collectPgBouncer,
} from './collect-pgbouncer.js';
import {
	type PgBouncerEndpoint,
	resolvePgBouncerEndpoints,
} from './pgbouncer-config.js';

vi.mock('./admin-console.js');
vi.mock('./pgbouncer-config.js');

afterEach(() => {
	vi.clearAllMocks();
});

const endpoint: PgBouncerEndpoint = {
	id: 'pgbouncer:6432',
	host: 'pgbouncer',
	port: 6432,
	database: 'pgbouncer',
	user: 'postgres',
	password: 'secret',
	connections: [
		{ name: 'free', database: 'directus_free' },
		{ name: 'premium', database: 'directus_premium' },
	],
};

/**
 * Rows shaped as pgbouncer 1.25 really answers them: `SHOW POOLS` and
 * `SHOW DATABASES` come back as integers, `SHOW STATS` as int8 text.
 */
function poolRow(overrides: AdminRow = {}): AdminRow {
	return {
		database: 'directus_free',
		user: 'postgres',
		cl_active: 2,
		cl_waiting: 0,
		sv_active: 1,
		sv_idle: 0,
		sv_used: 0,
		sv_login: 0,
		maxwait: 0,
		maxwait_us: 0,
		pool_mode: 'transaction',
		...overrides,
	};
}

function databaseRow(overrides: AdminRow = {}): AdminRow {
	return {
		name: 'directus_free',
		host: 'postgres',
		port: 5432,
		database: 'directus',
		force_user: 'postgres',
		pool_size: 1,
		reserve_pool_size: 0,
		pool_mode: null,
		paused: 0,
		disabled: 0,
		...overrides,
	};
}

test('A pool reads its counts, its size, and the connections that use it', () => {
	const pools = buildPools(
		endpoint,
		[poolRow({ cl_waiting: 3, maxwait: 1, maxwait_us: 500_000 })],
		[databaseRow()],
	);

	expect(pools).toEqual([{
		database: 'directus_free',
		user: 'postgres',
		poolMode: 'transaction',
		clientsActive: 2,
		clientsWaiting: 3,
		serversActive: 1,
		serversIdle: 0,
		serversUsed: 0,
		serversLogin: 0,
		// Whole seconds and their microsecond part are one duration.
		maxWaitMs: 1500,
		poolSize: 1,
		reservePoolSize: null,
		paused: false,
		disabled: false,
		connections: ['free'],
	}]);
});

test('A configured database that has taken no traffic is still listed', () => {
	const pools = buildPools(
		endpoint,
		[poolRow()],
		[databaseRow(), databaseRow({
			name: 'directus_premium',
			pool_size: 4,
			pool_mode: 'session',
		})],
	);

	expect(pools.map((pool) => pool.database)).toEqual([
		'directus_free',
		'directus_premium',
	]);

	// Idle, not absent — "never used" and "not configured" are different answers.
	expect(pools[1]).toMatchObject({
		user: 'postgres',
		poolMode: 'session',
		poolSize: 4,
		clientsActive: 0,
		clientsWaiting: 0,
		serversActive: 0,
		maxWaitMs: 0,
		connections: ['premium'],
	});
});

test('The console\'s own pool is not reported as a fronted one', () => {
	const pools = buildPools(
		endpoint,
		[poolRow(), poolRow({ database: 'pgbouncer', user: 'pgbouncer' })],
		[databaseRow(), databaseRow({ name: 'pgbouncer' })],
	);

	expect(pools.map((pool) => pool.database)).toEqual(['directus_free']);
});

test('A size of zero reads as inherited, not as no capacity', () => {
	const pools = buildPools(
		endpoint,
		[poolRow()],
		[databaseRow({ pool_size: 0, reserve_pool_size: 0 })],
	);

	expect(pools[0]!.poolSize).toBeNull();
	expect(pools[0]!.reservePoolSize).toBeNull();
});

test('A paused or disabled database says so', () => {
	const pools = buildPools(
		endpoint,
		[poolRow()],
		[databaseRow({ paused: 1, disabled: 1 })],
	);

	expect(pools[0]).toMatchObject({ paused: true, disabled: true });
});

test('A pool no connection of this deployment uses carries none', () => {
	const pools = buildPools(
		endpoint,
		[poolRow({ database: 'other_app' })],
		[databaseRow({ name: 'other_app' })],
	);

	expect(pools[0]!.connections).toEqual([]);
});

test('Clients report what they are and how long they have waited', () => {
	const clients = buildClients([
		{
			database: 'directus_free',
			user: 'postgres',
			state: 'waiting',
			addr: '172.18.0.4',
			port: 55_012,
			application_name: 'directus:aB3dE5fG:free',
			wait: 2,
			wait_us: 250_000,
			connect_time: '2026-08-13 14:02:11 UTC',
			tls: '',
			link: '',
		},
		{
			database: 'pgbouncer',
			user: 'pgbouncer',
			state: 'active',
			addr: '172.18.0.4',
			port: 55_013,
			application_name: 'directus-pgbouncer-admin',
			wait: 0,
			wait_us: 0,
			connect_time: '2026-08-13 14:02:11 UTC',
			tls: '',
			link: '',
		},
	]);

	// The reader's own admin session is not one of the pooled clients.
	expect(clients).toHaveLength(1);

	expect(clients[0]).toEqual({
		database: 'directus_free',
		user: 'postgres',
		state: 'waiting',
		addr: '172.18.0.4',
		port: 55_012,
		applicationName: 'directus:aB3dE5fG:free',
		waitMs: 2250,
		connectedAt: '2026-08-13 14:02:11 UTC',
		tls: '',
		linked: false,
	});
});

test('A client holding a server connection reads as linked', () => {
	const clients = buildClients([{
		database: 'directus_free',
		user: 'postgres',
		state: 'active',
		addr: '172.18.0.4',
		port: 55_014,
		application_name: '',
		wait: 0,
		wait_us: 0,
		connect_time: '',
		tls: '',
		link: '0x5581e0',
	}]);

	expect(clients[0]!.linked).toBe(true);
});

test('Servers report the backend they are, when they have one', () => {
	const servers = buildServers([
		{
			database: 'directus_free',
			user: 'postgres',
			state: 'idle',
			addr: '172.18.0.3',
			port: 5432,
			connect_time: '2026-08-13 14:02:10 UTC',
			tls: '',
			remote_pid: 4211,
		},
		{
			database: 'directus_premium',
			user: 'postgres',
			state: 'login',
			addr: '172.18.0.3',
			port: 5432,
			connect_time: '2026-08-13 14:02:10 UTC',
			tls: '',
			remote_pid: 0,
		},
	]);

	expect(servers[0]!.remotePid).toBe(4211);

	// A backend still logging in has no pid to report yet.
	expect(servers[1]!.remotePid).toBeNull();
});

test('Stats are numbers, however pgbouncer typed them', () => {
	const stats = buildStats([{
		database: 'directus_free',
		total_xact_count: '1204',
		total_query_count: '3907',
		total_received: '81234',
		total_sent: '9912345',
		total_wait_time: '5120000',
		avg_xact_count: '20',
		avg_query_count: '65',
		avg_query_time: '412',
		avg_wait_time: '85000',
	}]);

	expect(stats).toEqual([{
		database: 'directus_free',
		totalXactCount: 1204,
		totalQueryCount: 3907,
		totalReceivedBytes: 81_234,
		totalSentBytes: 9_912_345,
		totalWaitTimeUs: 5_120_000,
		avgXactCount: 20,
		avgQueryCount: 65,
		avgQueryTimeUs: 412,
		avgWaitTimeUs: 85_000,
	}]);
});

test('Only the settings that explain a queue are carried', () => {
	const limits = buildLimits([
		{ key: 'query_wait_timeout', value: '1', default: '120', changeable: 'yes' },
		{
			key: 'pool_mode',
			value: 'transaction',
			default: 'session',
			changeable: 'yes',
		},
		{ key: 'max_client_conn', value: '100', default: '100', changeable: 'yes' },
		{ key: 'auth_file', value: '/etc/userlist.txt', default: '', changeable: 'yes' },
	]);

	expect(limits.map((limit) => limit.key)).toEqual([
		'pool_mode',
		'max_client_conn',
		'query_wait_timeout',
	]);

	// A value left at its default is marked, so an override stands out.
	expect(limits).toContainEqual({
		key: 'max_client_conn',
		value: '100',
		default: '100',
		isDefault: true,
	});

	expect(limits).toContainEqual({
		key: 'query_wait_timeout',
		value: '1',
		default: '120',
		isDefault: false,
	});
});

test('Only the asked-for parts are queried', async () => {
	vi.mocked(resolvePgBouncerEndpoints).mockReturnValue([endpoint]);
	vi.mocked(showPgBouncer).mockResolvedValue([]);

	await collectPgBouncer(['pools']);

	const commands = vi.mocked(showPgBouncer).mock.calls.map((call) => call[1]);

	expect(commands).toEqual(['SHOW VERSION', 'SHOW POOLS', 'SHOW DATABASES']);
});

test('An unreachable instance reports why, and the others still read', async () => {
	const other: PgBouncerEndpoint = { ...endpoint, id: 'pgb2:6432', host: 'pgb2' };

	vi.mocked(resolvePgBouncerEndpoints).mockReturnValue([endpoint, other]);

	vi.mocked(showPgBouncer).mockImplementation(async (target, command) => {
		if (target.host === 'pgbouncer') {
			throw new Error('connect ECONNREFUSED 172.18.0.9:6432');
		}

		return command === 'SHOW VERSION'
			? [{ version: 'PgBouncer 1.25.2' }]
			: [];
	});

	const report = await collectPgBouncer(['pools']);

	expect(report.instances[0]).toMatchObject({
		id: 'pgbouncer:6432',
		reachable: false,
		error: 'connect ECONNREFUSED 172.18.0.9:6432',
		version: null,
	});

	expect(report.instances[1]).toMatchObject({
		id: 'pgb2:6432',
		reachable: true,
		error: null,
		version: 'PgBouncer 1.25.2',
	});
});
