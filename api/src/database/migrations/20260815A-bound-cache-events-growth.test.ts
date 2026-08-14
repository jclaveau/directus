import { beforeEach, describe, expect, it, vi } from 'vitest';
import { down, up } from './20260815A-bound-cache-events-growth.js';

vi.mock('@directus/env', () => ({ useEnv: () => env }));

const env: Record<string, unknown> = {};

// Answers the two probes apart, so a case can present the combination the
// guard exists for: the extension installed over a table that stayed plain.
function fakeKnex(
	client: string,
	hasExtension: boolean,
	hasHypertable = hasExtension,
) {
	const raw = vi.fn(async (sql: string) => {
		if (sql.includes('pg_extension')) {
			return { rows: [{ has: hasExtension }] };
		}

		if (sql.includes('timescaledb_information.hypertables')) {
			return { rows: [{ has: hasHypertable }] };
		}

		return { rows: [] };
	});

	return { client: { config: { client } }, raw } as any;
}

const statementsOf = (knex: any) =>
	knex.raw.mock.calls.map(([statement]: [string]) => statement);

beforeEach(() => {
	delete env['CACHE_STATS_RETENTION'];
});

describe('the cache events growth migration', () => {
	it('cuts the chunk interval down to a single day', async () => {
		const knex = fakeKnex('pg', true);

		await up(knex);

		expect(statementsOf(knex)).toContain(
			`SELECT set_chunk_time_interval('directus_cache_events', INTERVAL '1 day')`,
		);
	});

	it('re-derives the retention window from CACHE_STATS_RETENTION', async () => {
		env['CACHE_STATS_RETENTION'] = '20d';
		const knex = fakeKnex('pg', true);

		await up(knex);

		// Neither the 30d fallback below nor the window 20260710A froze.
		expect(statementsOf(knex)).toContain(
			`SELECT add_retention_policy('directus_cache_events', `
			+ `INTERVAL '1728000000 milliseconds')`,
		);
	});

	it('falls back to thirty days when the variable is unset', async () => {
		const knex = fakeKnex('pg', true);

		await up(knex);

		expect(statementsOf(knex)).toContain(
			`SELECT add_retention_policy('directus_cache_events', `
			+ `INTERVAL '2592000000 milliseconds')`,
		);
	});

	// Timescale refuses a second policy on one hypertable, so the other order
	// aborts on every already-migrated database — the only ones needing this.
	it('removes the frozen policy before adding its replacement', async () => {
		const knex = fakeKnex('pg', true);

		await up(knex);

		const statements = statementsOf(knex);

		const removed = statements
			.findIndex((s: string) => s.includes('remove_retention_policy'));

		const added = statements
			.findIndex((s: string) => s.includes('add_retention_policy'));

		expect(removed).toBeGreaterThan(-1);
		expect(added).toBeGreaterThan(removed);
	});

	it('leaves a plain table alone where the extension is absent', async () => {
		const knex = fakeKnex('pg', false);

		await up(knex);

		expect(statementsOf(knex).filter((s: string) => !s.includes('pg_extension')))
			.toEqual([]);
	});

	// The guard's own case: an extension installed after 20260710A ran leaves
	// the table plain, and set_chunk_time_interval throws on one.
	it('leaves a plain table alone under an installed extension', async () => {
		const knex = fakeKnex('pg', true, false);

		await up(knex);

		expect(
			statementsOf(knex)
				.filter((s: string) => s.includes('directus_cache_events'))
				.filter((s: string) => !s.includes('timescaledb_information')),
		).toEqual([]);
	});

	it('never reaches for the extension on another dialect', async () => {
		const knex = fakeKnex('sqlite3', true);

		await up(knex);

		// `pg_extension` does not exist off Postgres, so the probe would throw.
		expect(knex.raw).not.toHaveBeenCalled();
	});

	it('restores the default interval on the way back down', async () => {
		const knex = fakeKnex('pg', true);

		await down(knex);

		expect(statementsOf(knex)).toContain(
			`SELECT set_chunk_time_interval('directus_cache_events', INTERVAL '7 days')`,
		);
	});

	// The window it replaced is unrecoverable, so writing one here would invent
	// a value the database never held.
	it('leaves the retention policy alone on the way back down', async () => {
		const knex = fakeKnex('pg', true);

		await down(knex);

		expect(statementsOf(knex).some((s: string) => s.includes('retention_policy')))
			.toBe(false);
	});
});
