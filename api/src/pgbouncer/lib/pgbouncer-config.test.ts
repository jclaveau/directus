import { useEnv } from '@directus/env';
import { afterEach, expect, test, vi } from 'vitest';
import {
	assertPgBouncerConnections,
	pgbouncerConnectionNames,
	pgbouncerQueryTimeoutMs,
	pgbouncerReportEnabled,
	requestedPgBouncerDetails,
	resolvePgBouncerEndpoints,
} from './pgbouncer-config.js';

// The registry these endpoints derive from is the real one, and importing it
// pulls modules that read the environment as they load — so the mock answers an
// empty environment from the start rather than an undefined one.
vi.mock('@directus/env', () => {
	return { useEnv: vi.fn(() => ({})) };
});

afterEach(() => {
	vi.clearAllMocks();
});

/**
 * The registry the endpoints are derived from: two tiers over one pooler, plus a
 * base pool on the database's own host, which is the shape the feature exists
 * for.
 */
function registryEnv(overrides: Record<string, unknown> = {}) {
	return {
		DB_CLIENT: 'pg',
		DB_HOST: 'postgres',
		DB_PORT: 5432,
		DB_DATABASE: 'directus',
		DB_USER: 'postgres',
		DB_PASSWORD: 'secret',
		DB_CONNECTIONS: ['free', 'premium'],
		DB_CONNECTION_FREE_HOST: 'pgbouncer',
		DB_CONNECTION_FREE_PORT: 6432,
		DB_CONNECTION_FREE_DATABASE: 'directus_free',
		DB_CONNECTION_PREMIUM_HOST: 'pgbouncer',
		DB_CONNECTION_PREMIUM_PORT: 6432,
		DB_CONNECTION_PREMIUM_DATABASE: 'directus_premium',
		PGBOUNCER_CONNECTIONS: ['free', 'premium'],
		...overrides,
	};
}

test('The report is served only where it was turned on', () => {
	vi.mocked(useEnv).mockReturnValue({ PGBOUNCER_REPORT_ENABLED: true });
	expect(pgbouncerReportEnabled()).toBe(true);

	vi.mocked(useEnv).mockReturnValue({ PGBOUNCER_REPORT_ENABLED: false });
	expect(pgbouncerReportEnabled()).toBe(false);

	// Absent is off: a deployment without a pooler gets no page by default.
	vi.mocked(useEnv).mockReturnValue({});
	expect(pgbouncerReportEnabled()).toBe(false);
});

test('Configured connection names are read and trimmed', () => {
	vi.mocked(useEnv)
		.mockReturnValue({ PGBOUNCER_CONNECTIONS: [' free ', 'premium', ''] });

	expect(pgbouncerConnectionNames()).toEqual(['free', 'premium']);

	vi.mocked(useEnv).mockReturnValue({});
	expect(pgbouncerConnectionNames()).toEqual([]);
});

test('The query timeout falls back when unset or unparseable', () => {
	vi.mocked(useEnv).mockReturnValue({ PGBOUNCER_QUERY_TIMEOUT: '5s' });
	expect(pgbouncerQueryTimeoutMs()).toBe(5000);

	vi.mocked(useEnv).mockReturnValue({});
	expect(pgbouncerQueryTimeoutMs()).toBe(2000);
});

test('Connections sharing one pooler fold into a single instance', () => {
	vi.mocked(useEnv).mockReturnValue(registryEnv());

	const endpoints = resolvePgBouncerEndpoints();

	expect(endpoints).toHaveLength(1);
	expect(endpoints[0]!.id).toBe('pgbouncer:6432');
	expect(endpoints[0]!.host).toBe('pgbouncer');
	expect(endpoints[0]!.port).toBe(6432);

	// Both tiers are accounted for by the one console that serves them, each
	// carrying the pool it lands in.
	expect(endpoints[0]!.connections).toEqual([
		{ name: 'free', database: 'directus_free' },
		{ name: 'premium', database: 'directus_premium' },
	]);
});

test('Admin credentials default to the connection\'s own', () => {
	vi.mocked(useEnv).mockReturnValue(registryEnv());

	expect(resolvePgBouncerEndpoints()[0]).toMatchObject({
		database: 'pgbouncer',
		user: 'postgres',
		password: 'secret',
	});
});

test('Admin credentials are overridable per connection', () => {
	vi.mocked(useEnv).mockReturnValue(registryEnv({
		PGBOUNCER_FREE_ADMIN_USER: 'stats',
		PGBOUNCER_FREE_ADMIN_PASSWORD: 'stats-secret',
		PGBOUNCER_FREE_ADMIN_DATABASE: 'admin',
	}));

	expect(resolvePgBouncerEndpoints()[0]).toMatchObject({
		database: 'admin',
		user: 'stats',
		password: 'stats-secret',
	});
});

test('Each member of an HA fleet is read as its own instance', () => {
	vi.mocked(useEnv).mockReturnValue(registryEnv({
		PGBOUNCER_CONNECTIONS: ['free'],
		PGBOUNCER_FREE_ADMIN_HOSTS: ['pgb1:6432', 'pgb2:7432', 'pgb3'],
	}));

	const endpoints = resolvePgBouncerEndpoints();

	expect(endpoints.map((endpoint) => endpoint.id)).toEqual([
		'pgb1:6432',
		'pgb2:7432',
		// A member named without a port falls back to pgbouncer's own default,
		// not to the connection's port.
		'pgb3:6432',
	]);

	expect(endpoints[1]!.port).toBe(7432);
});

test('The base connection can be the one behind the pooler', () => {
	vi.mocked(useEnv).mockReturnValue(registryEnv({
		DB_HOST: 'pgbouncer',
		DB_PORT: 6432,
		PGBOUNCER_CONNECTIONS: ['base'],
	}));

	expect(resolvePgBouncerEndpoints()).toEqual([
		expect.objectContaining({
			id: 'pgbouncer:6432',
			connections: [{ name: 'base', database: 'directus' }],
		}),
	]);
});

test('An unknown or non-Postgres connection fails at boot', () => {
	vi.mocked(useEnv)
		.mockReturnValue(registryEnv({ PGBOUNCER_CONNECTIONS: ['analytics'] }));

	expect(() => assertPgBouncerConnections())
		.toThrowError(/"analytics", which is not a configured DB connection/);

	vi.mocked(useEnv).mockReturnValue(registryEnv({
		DB_CONNECTIONS: ['free', 'premium', 'reports'],
		DB_CONNECTION_REPORTS_CLIENT: 'mysql',
		PGBOUNCER_CONNECTIONS: ['reports'],
	}));

	expect(() => assertPgBouncerConnections())
		.toThrowError(/uses client "mysql", which pgbouncer cannot front/);
});

test('A registry the report covers passes the boot check', () => {
	vi.mocked(useEnv).mockReturnValue(registryEnv());

	expect(() => assertPgBouncerConnections()).not.toThrow();
});

test('A request asks for the parts it will show, and nothing else', () => {
	vi.mocked(useEnv).mockReturnValue({});

	// The connection lists are the expensive halves, so they are opt-in.
	expect(requestedPgBouncerDetails(undefined)).toEqual([
		'pools',
		'stats',
		'limits',
	]);

	expect(requestedPgBouncerDetails('')).toEqual(['pools', 'stats', 'limits']);

	expect(requestedPgBouncerDetails('pools, clients')).toEqual([
		'pools',
		'clients',
	]);

	// A part that does not exist is dropped, not answered with.
	expect(requestedPgBouncerDetails('pools,passwords')).toEqual(['pools']);
});
