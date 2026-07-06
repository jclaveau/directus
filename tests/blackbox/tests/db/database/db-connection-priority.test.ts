import { getUrl } from '@common/config';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { setDirectusEnv } from '@utils/set-directus-env';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';

// Routing is DB-client-agnostic, so probe on the pg family only: their knex connection config
// exposes `.database` (sqlite uses a filename), and they never run validateDatabaseCharset's MySQL
// collation query, so a connection that points at a fake database is safe to build.
const PG_FAMILY = ['postgres', 'postgres10', 'cockroachdb'];

const PROBE_VENDORS = vendors.filter((vendor) => PG_FAMILY.includes(vendor));

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
