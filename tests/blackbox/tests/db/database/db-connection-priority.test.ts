import { getUrl } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { setDirectusEnv } from '@utils/set-directus-env';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

// Routing is DB-client-agnostic, so check it on the pg family only: their knex
// connection config exposes `.database` (sqlite uses a filename), and they never
// run validateDatabaseCharset's MySQL collation query — so a connection pointing
// at a fake database is safe to build.
const PG_FAMILY_NAMES = ['postgres', 'postgres10', 'cockroachdb'];

const ROUTING_VENDORS = vendors.filter((vendor) => PG_FAMILY_NAMES.includes(vendor));

// The exhaustion tests drive a real slow query (`pg_sleep`), which cockroachdb
// lacks.
const PG_SLEEP_NAMES = ['postgres', 'postgres10'];

const EXHAUST_VENDORS = vendors.filter((vendor) => PG_SLEEP_NAMES.includes(vendor));

// pgbouncer (docker-compose) only fronts the `postgres` service, so the real
// pgbouncer queue-timeout case runs there alone.
const PGBOUNCER_VENDORS = vendors.filter((vendor) => vendor === 'postgres');

async function routedDatabaseForGrants(
	vendor: Vendor,
	dbConnections: string[],
): Promise<string> {
	const response = await request(getUrl(vendor))
		.post('/db-connection-probe/route')
		.send({ dbConnections })
		.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

	expect(response.statusCode).toBe(200);

	return response.body.data.database;
}

describe('DB connection priority routing', () => {
	afterAll(async () => {
		// Reset the shared instance so later test files see plain default routing
		for (const vendor of ROUTING_VENDORS) {
			await setDirectusEnv(vendor, 'DB_CONNECTIONS', '');
			await setDirectusEnv(vendor, 'DB_DEFAULT_CONNECTION_PRIORITY', '0');
		}
	});

	// No pg-family vendor active (e.g. sqlite3-only run) → nothing to route.
	// Register a skipped test so the file isn't an empty suite (vitest fails).
	if (ROUTING_VENDORS.length === 0) {
		it.skip('no pg-family vendor in this run', () => {
			// nothing to route
		});
	}

	it.each(ROUTING_VENDORS)(
		'%s respects connection priority across several grants',
		async (vendor) => {
			const defaultDatabase = await routedDatabaseForGrants(vendor, []);

			await Promise.all([
				setDirectusEnv(vendor, 'DB_CONNECTIONS', 'bb_lo,bb_mid,bb_hi'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BB_LO_DATABASE', 'bb_db_lo'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BB_LO_PRIORITY', '10'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BB_MID_DATABASE', 'bb_db_mid'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BB_MID_PRIORITY', '50'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BB_HI_DATABASE', 'bb_db_hi'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BB_HI_PRIORITY', '100'),
			]);

			// Highest priority wins regardless of the order the grants are listed in
			expect(
				await routedDatabaseForGrants(vendor, ['bb_lo', 'bb_hi', 'bb_mid']),
			).toBe('bb_db_hi');

			// A single grant routes to exactly that connection
			expect(await routedDatabaseForGrants(vendor, ['bb_lo'])).toBe('bb_db_lo');

			// Among several grants the highest priority still wins
			expect(
				await routedDatabaseForGrants(vendor, ['bb_mid', 'bb_lo']),
			).toBe('bb_db_mid');

			// No grants → the default pool
			expect(await routedDatabaseForGrants(vendor, [])).toBe(defaultDatabase);

			// An unconfigured grant is skipped → the default pool
			expect(await routedDatabaseForGrants(vendor, ['ghost'])).toBe(defaultDatabase);

			// The default pool competes: raise it above every grant and it wins
			await setDirectusEnv(vendor, 'DB_DEFAULT_CONNECTION_PRIORITY', '999');
			expect(await routedDatabaseForGrants(vendor, ['bb_hi'])).toBe(defaultDatabase);
			await setDirectusEnv(vendor, 'DB_DEFAULT_CONNECTION_PRIORITY', '0');
		},
		300_000,
	);
});

describe('DB pool exhaustion error', () => {
	afterAll(async () => {
		for (const vendor of EXHAUST_VENDORS) {
			await setDirectusEnv(vendor, 'DB_CONNECTIONS', '');
		}
	});

	// Keep the suite non-empty when no pg vendor is active (vitest fails on empty).
	if (EXHAUST_VENDORS.length === 0) {
		it.skip('no pg vendor for pg_sleep in this run', () => {
			// nothing to exhaust
		});
	}

	it.each(EXHAUST_VENDORS)(
		'%s surfaces 429 DATABASE_POOL_EXHAUSTED when the client-side pool is saturated',
		async (vendor) => {
			// A tier that inherits the base db but caps its OWN knex/tarn pool at one
			// connection with a tight acquire timeout — concurrent queries can't all get
			// a connection and time out client-side (no pgbouncer involved). This is the
			// client_pool_timeout reason.
			await Promise.all([
				setDirectusEnv(vendor, 'DB_CONNECTIONS', 'tiny'),
				setDirectusEnv(vendor, 'DB_CONNECTION_TINY_PRIORITY', '100'),
				setDirectusEnv(vendor, 'DB_CONNECTION_TINY_POOL__MIN', '0'),
				setDirectusEnv(vendor, 'DB_CONNECTION_TINY_POOL__MAX', '1'),
				setDirectusEnv(
					vendor,
					'DB_CONNECTION_TINY_POOL__ACQUIRE_TIMEOUT_MILLIS',
					'150',
				),
			]);

			const response = await request(getUrl(vendor))
				.post('/db-connection-probe/exhaust')
				.send({ dbConnections: ['tiny'], concurrency: 5, sleep: 1 })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(429);

			expect(response.body.errors[0].extensions.code).toBe(
				'DATABASE_POOL_EXHAUSTED',
			);

			expect(response.body.errors[0].extensions.reason).toBe('client_pool_timeout');
			expect(response.headers['retry-after']).toBe('1');
		},
		300_000,
	);

	it.each(PGBOUNCER_VENDORS)(
		'%s surfaces 429 DATABASE_POOL_EXHAUSTED when the pgbouncer queue times out',
		async (vendor) => {
			// A tier routed through pgbouncer (docker-compose: transaction pool_mode,
			// default_pool_size=1, query_wait_timeout=1s, max_client_conn=2). Two
			// concurrent queries both connect (at the client cap), one queues on the
			// single server connection, and pgbouncer raises `query_wait_timeout` — the
			// pool_queue_timeout reason.
			await Promise.all([
				setDirectusEnv(vendor, 'DB_CONNECTIONS', 'bouncer'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BOUNCER_PRIORITY', '100'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BOUNCER_PORT', '6109'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BOUNCER_POOL__MAX', '8'),
			]);

			const response = await request(getUrl(vendor))
				.post('/db-connection-probe/exhaust')
				.send({ dbConnections: ['bouncer'], concurrency: 2, sleep: 2 })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(429);

			expect(response.body.errors[0].extensions.code).toBe(
				'DATABASE_POOL_EXHAUSTED',
			);

			expect(response.body.errors[0].extensions.reason).toBe('pool_queue_timeout');
			expect(response.headers['retry-after']).toBe('1');
		},
		300_000,
	);

	it.each(PGBOUNCER_VENDORS)(
		'%s surfaces 429 DATABASE_POOL_EXHAUSTED when pgbouncer refuses new clients',
		async (vendor) => {
			// Same pgbouncer tier, but push more concurrent connections than its
			// max_client_conn (2): pgbouncer rejects the surplus at connect time with
			// `no more connections allowed` — the real max_client_connections reason. The
			// reject is immediate, so it wins the race against the 1s queue timeout.
			await Promise.all([
				setDirectusEnv(vendor, 'DB_CONNECTIONS', 'bouncer'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BOUNCER_PRIORITY', '100'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BOUNCER_PORT', '6109'),
				setDirectusEnv(vendor, 'DB_CONNECTION_BOUNCER_POOL__MAX', '8'),
			]);

			const response = await request(getUrl(vendor))
				.post('/db-connection-probe/exhaust')
				.send({ dbConnections: ['bouncer'], concurrency: 5, sleep: 2 })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(429);

			expect(response.body.errors[0].extensions.code).toBe(
				'DATABASE_POOL_EXHAUSTED',
			);

			expect(response.body.errors[0].extensions.reason).toBe(
				'max_client_connections',
			);

			expect(response.headers['retry-after']).toBe('1');
		},
		300_000,
	);

	// The fourth reason, `too_many_connections` (postgres SQLSTATE 53300), stays
	// unit-only: reaching it means exhausting the shared postgres backend's
	// max_connections, which would break every other test on that instance.
});
