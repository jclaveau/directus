import { getUrl } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { setDirectusEnv } from '@utils/set-directus-env';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

// Routing is DB-client-agnostic, so probe on the pg family only: their knex
// connection config exposes `.database` (sqlite uses a filename), and they never
// run validateDatabaseCharset's MySQL collation query — so a connection pointing
// at a fake database is safe to build.
const PG_FAMILY = ['postgres', 'postgres10', 'cockroachdb'];

const PROBE_VENDORS = vendors.filter((vendor) => PG_FAMILY.includes(vendor));

// The exhaustion test drives a real slow query (`pg_sleep`), which cockroachdb lacks.
const PG_SLEEP_VENDORS = ['postgres', 'postgres10'];

const EXHAUST_VENDORS = vendors.filter((vendor) => PG_SLEEP_VENDORS.includes(vendor));

async function probe(vendor: Vendor, dbConnections: string[]): Promise<string> {
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
		for (const vendor of PROBE_VENDORS) {
			await setDirectusEnv(vendor, 'DB_CONNECTIONS', '');
			await setDirectusEnv(vendor, 'DB_DEFAULT_CONNECTION_PRIORITY', '0');
		}
	});

	// No pg-family vendor active (e.g. sqlite3-only run) → nothing to probe.
	// Register a skipped test so the file isn't an empty suite (vitest fails).
	if (PROBE_VENDORS.length === 0) {
		it.skip('no pg-family vendor in this run', () => {
			// nothing to probe
		});
	}

	it.each(PROBE_VENDORS)(
		'%s respects connection priority across several grants',
		async (vendor) => {
			const defaultDatabase = await probe(vendor, []);

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
			expect(await probe(vendor, ['bb_lo', 'bb_hi', 'bb_mid'])).toBe('bb_db_hi');

			// A single grant routes to exactly that connection
			expect(await probe(vendor, ['bb_lo'])).toBe('bb_db_lo');

			// Among several grants the highest priority still wins
			expect(await probe(vendor, ['bb_mid', 'bb_lo'])).toBe('bb_db_mid');

			// No grants → the default pool
			expect(await probe(vendor, [])).toBe(defaultDatabase);

			// An unconfigured grant is skipped → the default pool
			expect(await probe(vendor, ['ghost'])).toBe(defaultDatabase);

			// The default pool competes: raise it above every grant and it wins
			await setDirectusEnv(vendor, 'DB_DEFAULT_CONNECTION_PRIORITY', '999');
			expect(await probe(vendor, ['bb_hi'])).toBe(defaultDatabase);
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
		'%s surfaces 429 DATABASE_POOL_EXHAUSTED when a tier pool is saturated',
		async (vendor) => {
			// A tier that inherits the base db but caps its pool at one connection with a tight
			// acquire timeout — concurrent queries can't all get a connection and time out.
			await Promise.all([
				setDirectusEnv(vendor, 'DB_CONNECTIONS', 'tiny'),
				setDirectusEnv(vendor, 'DB_CONNECTION_TINY_PRIORITY', '100'),
				setDirectusEnv(vendor, 'DB_CONNECTION_TINY_POOL__MIN', '0'),
				setDirectusEnv(vendor, 'DB_CONNECTION_TINY_POOL__MAX', '1'),
				setDirectusEnv(vendor, 'DB_CONNECTION_TINY_POOL__ACQUIRE_TIMEOUT_MILLIS', '150'),
			]);

			const response = await request(getUrl(vendor))
				.post('/db-connection-probe/exhaust')
				.send({ dbConnections: ['tiny'], concurrency: 5, sleep: 1 })
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toBe(429);
			expect(response.body.errors[0].extensions.code).toBe('DATABASE_POOL_EXHAUSTED');
			expect(response.body.errors[0].extensions.reason).toBe('client_pool_timeout');
			expect(response.headers['retry-after']).toBe('1');
		},
		300_000,
	);
});
