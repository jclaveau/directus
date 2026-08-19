import { beforeEach, describe, expect, it, vi } from 'vitest';
import { down, up } from './20260819A-fit-cache-stats-in-budget.js';

vi.mock('@directus/env', () => ({ useEnv: () => env }));

const env: Record<string, unknown> = {};

const bothTables = ['directus_cache_events', 'directus_cache_purges'];

const hypertableProbe = 'timescaledb_information.hypertables';

// Answers the hypertable probe per table, so a case can present the combination
// the guard exists for: the extension installed over a table that stayed plain.
function fakeKnex(
	client: string,
	hasExtension: boolean,
	hypertables: string[] = bothTables,
) {
	const raw = vi.fn(async (sql: string) => {
		if (sql.includes('pg_extension')) {
			return { rows: [{ has: hasExtension }] };
		}

		if (sql.includes(hypertableProbe)) {
			const asked = hypertables
				.some((table) => sql.includes(`= '${table}'`));

			return { rows: [{ has: asked }] };
		}

		return { rows: [] };
	});

	return { client: { config: { client } }, raw } as any;
}

const statementsOf = (knex: any) =>
	knex.raw.mock.calls.map(([statement]: [string]) => statement);

function actedOn(knex: any, table: string) {
	return statementsOf(knex)
		.filter((statement: string) => statement.includes(table))
		.filter((statement: string) => !statement.includes(hypertableProbe));
}

beforeEach(() => {
	delete env['CACHE_STATS_RETENTION'];
});

describe('the cache stats budget migration', () => {
	it('puts both facts on one-day chunks', async () => {
		const knex = fakeKnex('pg', true);

		await up(knex);

		expect(statementsOf(knex)).toContain(
			`SELECT set_chunk_time_interval('directus_cache_purges', INTERVAL '1 day')`,
		);

		expect(statementsOf(knex)).toContain(
			`SELECT set_chunk_time_interval('directus_cache_events', INTERVAL '1 day')`,
		);
	});

	it('compresses each fact two hours after a chunk closes', async () => {
		const knex = fakeKnex('pg', true);

		await up(knex);

		// One hour would sit exactly on CACHE_STATS_GAP_LOOKBACK, whose late
		// arrivals would then land in a chunk that had just compressed.
		expect(statementsOf(knex)).toContain(
			`SELECT add_compression_policy('directus_cache_events', `
			+ `compress_after => INTERVAL '2 hours', `
			+ `schedule_interval => INTERVAL '1 hour')`,
		);

		// The schedule is half the fix: at the twelve hours it replaces, the job
		// woke twice a day and rounded the window above up to half a day.
		expect(statementsOf(knex)).toContain(
			`SELECT add_compression_policy('directus_cache_purges', `
			+ `compress_after => INTERVAL '2 hours', `
			+ `schedule_interval => INTERVAL '1 hour')`,
		);
	});

	it('re-derives both retention windows from CACHE_STATS_RETENTION', async () => {
		env['CACHE_STATS_RETENTION'] = '14d';
		const knex = fakeKnex('pg', true);

		await up(knex);

		// Neither the 30d fallback below nor the 20d window 20260815A froze.
		expect(statementsOf(knex)).toContain(
			`SELECT add_retention_policy('directus_cache_events', `
			+ `INTERVAL '1209600000 milliseconds')`,
		);

		expect(statementsOf(knex)).toContain(
			`SELECT add_retention_policy('directus_cache_purges', `
			+ `INTERVAL '1209600000 milliseconds')`,
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

	// Timescale refuses a second policy of either kind on one hypertable, so the
	// other order aborts on every already-migrated database — the only ones it is for.
	it.each([
		['retention'],
		['compression'],
	])('removes the frozen %s policy before adding its replacement', async (kind) => {
		const knex = fakeKnex('pg', true);

		await up(knex);

		const statements = actedOn(knex, 'directus_cache_events');

		const removed = statements
			.findIndex((s: string) => s.includes(`remove_${kind}_policy`));

		const added = statements
			.findIndex((s: string) => s.includes(`add_${kind}_policy`));

		expect(removed).toBeGreaterThan(-1);
		expect(added).toBeGreaterThan(removed);
	});

	it('leaves both facts alone where the extension is absent', async () => {
		const knex = fakeKnex('pg', false);

		await up(knex);

		expect(statementsOf(knex).filter((s: string) => !s.includes('pg_extension')))
			.toEqual([]);
	});

	// The purge fact is younger, so a database can carry one as a hypertable and
	// the other plain — which is why each is probed separately.
	it('leaves a plain fact alone beside a hypertable one', async () => {
		const knex = fakeKnex('pg', true, ['directus_cache_events']);

		await up(knex);

		expect(actedOn(knex, 'directus_cache_purges')).toEqual([]);
		expect(actedOn(knex, 'directus_cache_events')).not.toEqual([]);
	});

	it('never reaches for the extension on another dialect', async () => {
		const knex = fakeKnex('sqlite3', true);

		await up(knex);

		// `pg_extension` does not exist off Postgres, so the probe would throw.
		expect(knex.raw).not.toHaveBeenCalled();
	});

	// Seven days there would undo 20260815A rather than this migration.
	it('returns the purge chunks to seven days only', async () => {
		const knex = fakeKnex('pg', true);

		await down(knex);

		expect(statementsOf(knex)).toContain(
			`SELECT set_chunk_time_interval('directus_cache_purges', INTERVAL '7 days')`,
		);

		const eventChunks = actedOn(knex, 'directus_cache_events')
			.filter((s: string) => s.includes('set_chunk_time_interval'));

		expect(eventChunks).toEqual([]);
	});

	it('returns both compression windows to two days', async () => {
		const knex = fakeKnex('pg', true);

		await down(knex);

		expect(statementsOf(knex)).toContain(
			`SELECT add_compression_policy('directus_cache_events', INTERVAL '2 days')`,
		);

		expect(statementsOf(knex)).toContain(
			`SELECT add_compression_policy('directus_cache_purges', INTERVAL '2 days')`,
		);
	});

	// The window it replaced is unrecoverable, so writing one here would invent
	// a value the database never held.
	it('leaves the retention policies alone on the way back down', async () => {
		const knex = fakeKnex('pg', true);

		await down(knex);

		expect(statementsOf(knex).some((s: string) => s.includes('retention_policy')))
			.toBe(false);
	});
});
