import { getUrl } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { setDirectusEnv } from '@utils/set-directus-env';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

// Grant resolution is DB-client-agnostic, checked on the pg family only: their knex
// connection config exposes `.database` (sqlite uses a filename), and they never
// run validateDatabaseCharset's MySQL collation query — so a connection pointing
// at a fake database is safe to build.
const PG_FAMILY_NAMES = ['postgres', 'postgres10', 'cockroachdb'];

const GRANT_VENDORS = vendors.filter((vendor) => PG_FAMILY_NAMES.includes(vendor));

// The exhaustion tests drive a real slow query (`pg_sleep`), which cockroachdb
// lacks.
const PG_SLEEP_NAMES = ['postgres', 'postgres10'];

const EXHAUST_VENDORS = vendors.filter((vendor) => PG_SLEEP_NAMES.includes(vendor));

// pgbouncer (docker-compose) only fronts the `postgres` service, so the real
// pgbouncer queue-timeout case runs there alone.
const PGBOUNCER_VENDORS = vendors.filter((vendor) => vendor === 'postgres');

async function grantedDatabase(
	vendor: Vendor,
	grants: string[],
): Promise<string> {
	const response = await request(getUrl(vendor))
		.post('/db-connection-probe/granted')
		.send({ grantedDbConnections: grants })
		.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

	expect(response.statusCode).toBe(200);

	return response.body.data.database;
}

describe('DB connection priority', () => {
	afterAll(async () => {
		// Reset the shared instance so later test files see the plain default connection
		for (const vendor of GRANT_VENDORS) {
			await setDirectusEnv(vendor, 'DB_CONNECTIONS', '');
			await setDirectusEnv(vendor, 'DB_DEFAULT_CONNECTION_PRIORITY', '0');
		}
	});

	// No pg-family vendor active (e.g. sqlite3-only run) → nothing to grant.
	// Register a skipped test so the file isn't an empty suite (vitest fails).
	if (GRANT_VENDORS.length === 0) {
		it.skip('no pg-family vendor in this run', () => {
			// nothing to grant
		});
	}

	it.each(GRANT_VENDORS)(
		'%s respects connection priority across several grants',
		async (vendor) => {
			const defaultDatabase = await grantedDatabase(vendor, []);

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
				await grantedDatabase(vendor, ['bb_lo', 'bb_hi', 'bb_mid']),
			).toBe('bb_db_hi');

			expect(await grantedDatabase(vendor, ['bb_lo'])).toBe('bb_db_lo');

			expect(
				await grantedDatabase(vendor, ['bb_mid', 'bb_lo']),
			).toBe('bb_db_mid');

			expect(await grantedDatabase(vendor, [])).toBe(defaultDatabase);

			// An unconfigured grant is skipped → the default pool
			expect(await grantedDatabase(vendor, ['ghost'])).toBe(defaultDatabase);

			// The default pool competes: raise it above every grant and it wins
			await setDirectusEnv(vendor, 'DB_DEFAULT_CONNECTION_PRIORITY', '999');
			expect(await grantedDatabase(vendor, ['bb_hi'])).toBe(defaultDatabase);
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
				.post('/db-connection-probe/pools-under-load')
				.send({
					saturate: [{ connection: 'tiny', concurrency: 2 }],
					probe: ['tiny'],
					sleep: 1,
					onProbeError: 'propagate',
				})
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
		'%s surfaces 429 DATABASE_POOL_EXHAUSTED when a pgbouncer pool queue times out',
		async (vendor) => {
			// Grant a tier through pgbouncer's tiny `free` pool (pool_size=1,
			// query_wait_timeout=1s), saturate it, then probe it: the probe queues
			// past the timeout and pgbouncer raises `query_wait_timeout`, which
			// propagates as the pool_queue_timeout 429.
			await Promise.all([
				setDirectusEnv(vendor, 'DB_CONNECTIONS', 'free'),
				setDirectusEnv(vendor, 'DB_CONNECTION_FREE_PRIORITY', '100'),
				setDirectusEnv(vendor, 'DB_CONNECTION_FREE_PORT', '6109'),
				setDirectusEnv(vendor, 'DB_CONNECTION_FREE_DATABASE', 'directus_free'),
				setDirectusEnv(vendor, 'DB_CONNECTION_FREE_POOL__MAX', '8'),
			]);

			const response = await request(getUrl(vendor))
				.post('/db-connection-probe/pools-under-load')
				.send({
					saturate: [{ connection: 'free', concurrency: 2 }],
					probe: ['free'],
					sleep: 2,
					onProbeError: 'propagate',
				})
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

	// `too_many_connections` (pg 53300) and `max_client_connections` stay
	// unit-only (dialects/postgres.test.ts): the former needs exhausting the
	// shared postgres backend, the latter a low global max_client_conn that would
	// break the isolation tests below (which need many concurrent clients).
});

const POOL_TIERS = {
	free: 'directus_free',
	premium: 'directus_premium',
	shared: 'directus_default',
};

// Point a named connection at one of pgbouncer's pools (same host, dbname per
// tier), granted at a priority that outranks the base default.
function configureTier(vendor: Vendor, name: keyof typeof POOL_TIERS) {
	const prefix = `DB_CONNECTION_${name.toUpperCase()}`;

	return [
		setDirectusEnv(vendor, `${prefix}_PRIORITY`, '100'),
		setDirectusEnv(vendor, `${prefix}_PORT`, '6109'),
		setDirectusEnv(vendor, `${prefix}_DATABASE`, POOL_TIERS[name]),
		setDirectusEnv(vendor, `${prefix}_POOL__MAX`, '8'),
	];
}

describe('DB connection pool isolation', () => {
	afterAll(async () => {
		for (const vendor of PGBOUNCER_VENDORS) {
			await setDirectusEnv(vendor, 'DB_CONNECTIONS', '');
		}
	});

	if (PGBOUNCER_VENDORS.length === 0) {
		it.skip('no pgbouncer vendor in this run', () => {
			// nothing to isolate
		});
	}

	it.each(PGBOUNCER_VENDORS)(
		'%s keeps the premium pool serving while the free pool is saturated',
		async (vendor) => {
			// free (pool_size=1) and premium (pool_size=4) are separate pgbouncer
			// pools over the same db; saturating free must not starve premium.
			await Promise.all([
				setDirectusEnv(vendor, 'DB_CONNECTIONS', 'free,premium'),
				...configureTier(vendor, 'free'),
				...configureTier(vendor, 'premium'),
			]);

			const response = await request(getUrl(vendor))
				.post('/db-connection-probe/pools-under-load')
				.send({
					saturate: [{ connection: 'free', concurrency: 2 }],
					probe: ['premium', 'free'],
					sleep: 3,
					onProbeError: 'report',
				})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(200);

			const { results } = response.body.data;

			// premium keeps serving …
			expect(results.premium.ok).toBe(true);

			// … while free is genuinely saturated (non-vacuity control)
			expect(results.free.ok).toBe(false);
		},
		300_000,
	);

	it.each(PGBOUNCER_VENDORS)(
		'%s keeps the large default pool serving while free + premium are saturated',
		async (vendor) => {
			// Saturating both small pools must not starve the large `default` pool
			// (pool_size=50) — the always-available tier the control plane rides.
			await Promise.all([
				setDirectusEnv(vendor, 'DB_CONNECTIONS', 'free,premium,shared'),
				...configureTier(vendor, 'free'),
				...configureTier(vendor, 'premium'),
				...configureTier(vendor, 'shared'),
			]);

			const response = await request(getUrl(vendor))
				.post('/db-connection-probe/pools-under-load')
				.send({
					saturate: [
						{ connection: 'free', concurrency: 2 },
						{ connection: 'premium', concurrency: 5 },
					],
					probe: ['shared', 'premium'],
					sleep: 3,
					onProbeError: 'report',
				})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(200);

			const { results } = response.body.data;

			// the large default pool keeps serving …
			expect(results.shared.ok).toBe(true);

			// … while premium is genuinely saturated (non-vacuity control)
			expect(results.premium.ok).toBe(false);
		},
		300_000,
	);
});
