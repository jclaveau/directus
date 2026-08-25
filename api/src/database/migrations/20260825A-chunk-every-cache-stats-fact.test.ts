import { beforeEach, describe, expect, it, vi } from 'vitest';
import { down, up } from './20260825A-chunk-every-cache-stats-fact.js';
import { getHelpers } from '../helpers/index.js';

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('../helpers/index.js', () => ({ getHelpers: vi.fn() }));

const env: Record<string, unknown> = {};

const PURGE_TAGS = 'directus_scoped_cache_purge_tags';

const everyFact = [
	'directus_cache_events',
	'directus_cache_purges',
	PURGE_TAGS,
];

/**
 * Answers the dialect helper's two probes per table, so a case can present the
 * combination the guards exist for: the extension installed over a table that
 * stayed plain. A conversion registers the table, the way the catalog would
 * answer once `create_hypertable` returned.
 */
function fakeKnex(
	client: string,
	hasExtension: boolean,
	hypertables: string[] = everyFact,
) {
	const converted = new Set(hypertables);

	vi.mocked(getHelpers).mockReturnValue({
		schema: {
			hasTimescale: async () => client === 'pg' && hasExtension,
			isHypertable: async (table: string) => converted.has(table),
		},
	} as any);

	return {
		client: { config: { client } },
		raw: vi.fn(async (sql: string) => {
			if (sql.includes('create_hypertable')) {
				converted.add(PURGE_TAGS);
			}

			return { rows: [] };
		}),
	} as any;
}

const statementsOf = (knex: any) =>
	knex.raw.mock.calls.map(([statement]: [string]) => statement);

function actedOn(knex: any, table: string) {
	return statementsOf(knex)
		.filter((statement: string) => statement.includes(table));
}

beforeEach(() => {
	delete env['CACHE_STATS_RETENTION'];
});

describe('chunking every cache-stats fact', () => {
	it('puts all three facts on three-hour chunks', async () => {
		const knex = fakeKnex('pg', true);

		await up(knex);

		for (const table of everyFact) {
			expect(statementsOf(knex)).toContain(
				`SELECT set_chunk_time_interval('${table}', INTERVAL '3 hours')`,
			);
		}
	});

	it('converts the purge-tag fact it finds plain', async () => {
		const knex = fakeKnex('pg', true, [
			'directus_cache_events',
			'directus_cache_purges',
		]);

		await up(knex);

		// migrate_data carries the rows already there into their chunks; without
		// it the conversion refuses a table that is not empty.
		expect(statementsOf(knex)).toContain(
			`SELECT create_hypertable('${PURGE_TAGS}', 'time', `
			+ `chunk_time_interval => INTERVAL '3 hours', `
			+ `migrate_data => true, if_not_exists => true)`,
		);

		expect(actedOn(knex, PURGE_TAGS)).toContainEqual(
			expect.stringContaining(`timescaledb.compress_segmentby = 'collection'`),
		);

		// The conversion is not the end of it: the fresh hypertable takes the same
		// interval and policies as the two that were already chunked.
		expect(actedOn(knex, PURGE_TAGS)).toContainEqual(
			expect.stringContaining('add_compression_policy'),
		);
	});

	it('leaves a purge-tag fact that is already a hypertable alone', async () => {
		const knex = fakeKnex('pg', true);

		await up(knex);

		expect(statementsOf(knex)).not.toContainEqual(
			expect.stringContaining('create_hypertable'),
		);
	});

	it('skips a fact the extension arrived too late for', async () => {
		const knex = fakeKnex('pg', true, [PURGE_TAGS]);

		await up(knex);

		// Plain tables under an installed extension: the policy calls would throw
		// on them rather than answer no, so the probe has to hold them back.
		expect(actedOn(knex, 'directus_cache_events')).toEqual([]);
		expect(actedOn(knex, 'directus_cache_purges')).toEqual([]);
		expect(actedOn(knex, PURGE_TAGS)).not.toEqual([]);
	});

	it('re-derives the retention window from the env', async () => {
		env['CACHE_STATS_RETENTION'] = '7d';
		const knex = fakeKnex('pg', true);

		await up(knex);

		expect(statementsOf(knex)).toContain(
			`SELECT add_retention_policy('directus_cache_events', `
			+ `INTERVAL '604800000 milliseconds')`,
		);
	});

	it('keeps the compression window the interval does not move', async () => {
		const knex = fakeKnex('pg', true);

		await up(knex);

		// compress_after counts from a chunk's close, not from each row, so it
		// stays where 20260819A put it while the chunks get eight times shorter.
		for (const table of everyFact) {
			expect(statementsOf(knex)).toContain(
				`SELECT add_compression_policy('${table}', `
				+ `compress_after => INTERVAL '2 hours', `
				+ `schedule_interval => INTERVAL '1 hour')`,
			);
		}
	});

	it('removes each policy before adding it', async () => {
		const knex = fakeKnex('pg', true);

		await up(knex);

		const acted = actedOn(knex, 'directus_cache_events');

		const positionOf = (call: string) =>
			acted.findIndex((statement: string) => statement.includes(call));

		// Timescale refuses a second policy of either kind, so an add that runs
		// first aborts every database that already has one.
		expect(positionOf('remove_retention_policy'))
			.toBeLessThan(positionOf('add_retention_policy'));

		expect(positionOf('remove_compression_policy'))
			.toBeLessThan(positionOf('add_compression_policy'));
	});

	it('does nothing without the extension', async () => {
		const knex = fakeKnex('pg', false);

		await up(knex);

		expect(knex.raw).not.toHaveBeenCalled();
	});

	it('does nothing on a non-postgres client', async () => {
		const knex = fakeKnex('sqlite3', true);

		await up(knex);

		expect(knex.raw).not.toHaveBeenCalled();
	});
});

describe('reverting the chunking', () => {
	it('returns every fact to one-day chunks and drops the new policies', async () => {
		const knex = fakeKnex('pg', true);

		await down(knex);

		for (const table of everyFact) {
			expect(statementsOf(knex)).toContain(
				`SELECT set_chunk_time_interval('${table}', INTERVAL '1 day')`,
			);
		}

		expect(statementsOf(knex)).toContain(
			`SELECT remove_retention_policy('${PURGE_TAGS}', if_exists => true)`,
		);

		expect(statementsOf(knex)).toContain(
			`SELECT remove_compression_policy('${PURGE_TAGS}', if_exists => true)`,
		);
	});

	it('leaves the conversion in place', async () => {
		const knex = fakeKnex('pg', true);

		await down(knex);

		// Undoing it would copy every row back out of its chunks, a second deploy
		// window spent on a table shape nothing else reads.
		expect(statementsOf(knex)).not.toContainEqual(
			expect.stringContaining('drop_chunks'),
		);
	});

	it('does nothing on a non-postgres client', async () => {
		const knex = fakeKnex('sqlite3', true);

		await down(knex);

		expect(knex.raw).not.toHaveBeenCalled();
	});
});
