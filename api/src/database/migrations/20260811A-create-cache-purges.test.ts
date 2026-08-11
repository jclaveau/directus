import { beforeEach, describe, expect, it, vi } from 'vitest';
import { down, up } from './20260811A-create-cache-purges.js';

vi.mock('@directus/env', () => ({ useEnv: () => env }));

const env: Record<string, unknown> = { CACHE_STATS_RETENTION: '30d' };

/**
 * Records the column definitions rather than stubbing them away, so the shape
 * is asserted and not merely the fact that a table was asked for.
 */
function recordingTable(columns: string[], indexes: string[]) {
	function column(kind: string, name: string) {
		columns.push(`${kind} ${name}`);

		const chain: any = {
			notNullable: () => (columns[columns.length - 1] += ' notNullable', chain),
			nullable: () => (columns[columns.length - 1] += ' nullable', chain),
		};

		return chain;
	}

	return {
		increments: (name: string) => column('increments', name),
		timestamp: (name: string) => column('timestamp', name),
		string: (name: string) => column('string', name),
		integer: (name: string) => column('integer', name),
		index: (name: string) => indexes.push(name),
	};
}

function fakeKnex(client: string, hasTimescale: boolean) {
	const columns: string[] = [];
	const indexes: string[] = [];

	const raw = vi.fn(async (sql: string) => {
		return sql.includes('pg_extension')
			? { rows: [{ has: hasTimescale }] }
			: { rows: [] };
	});

	return {
		client: { config: { client } },
		schema: {
			createTable: vi.fn(async (_name: string, build: (t: any) => void) => {
				build(recordingTable(columns, indexes));
			}),
			dropTable: vi.fn(async () => undefined),
		},
		raw,
		columns,
		indexes,
	} as any;
}

beforeEach(() => {
	env['CACHE_STATS_RETENTION'] = '30d';
});

describe('the cache purges migration', () => {
	it('creates the table on every dialect', async () => {
		const knex = fakeKnex('sqlite3', false);

		await up(knex);

		expect(knex.schema.createTable)
			.toHaveBeenCalledWith('directus_cache_purges', expect.any(Function));

		expect(knex.columns).toEqual([
			'timestamp time notNullable',
			'string collection nullable',
			'string mode notNullable',
			'integer tags notNullable',
			// Unknown on a namespace clear, which has no member list to count.
			'integer evicted nullable',
		]);

		// No surrogate key: a hypertable refuses a unique index that leaves out its
		// partitioning column, so an `id` would have to become `(id, time)`.
		expect(knex.columns.some((c: string) => c.startsWith('increments'))).toBe(false);

		// `time` only — `mode` has three values and the timeseries folds it into a
		// CASE, so an index there would be write cost with no reader.
		expect(knex.indexes).toEqual(['time']);
	});

	it('drops the table on the way back down', async () => {
		const knex = fakeKnex('pg', true);

		await down(knex);

		expect(knex.schema.dropTable).toHaveBeenCalledWith('directus_cache_purges');
	});

	// The fact table beside it is a hypertable with compression and a retention
	// policy; a purge row is a fact of the same family and gets the same
	// treatment where the extension exists.
	it('makes it a hypertable where timescaledb is installed', async () => {
		const knex = fakeKnex('pg', true);

		await up(knex);

		const sql = knex.raw.mock.calls.map(([statement]: [string]) => statement);

		expect(sql.some((s: string) => s.includes('create_hypertable'))).toBe(true);
		expect(sql.some((s: string) => s.includes('timescaledb.compress'))).toBe(true);

		expect(sql.some((s: string) => s.includes('add_compression_policy')))
			.toBe(true);

		// Retention mirrors CACHE_STATS_RETENTION rather than a hardcoded window,
		// so a larger configured retention is not silently capped.
		const retention = sql.find((s: string) => s.includes('add_retention_policy'));

		expect(retention).toContain(String(2_592_000_000));
	});

	it('leaves a plain table where the extension is absent', async () => {
		const knex = fakeKnex('pg', false);

		await up(knex);

		const sql = knex.raw.mock.calls.map(([statement]: [string]) => statement);

		expect(sql.some((s: string) => s.includes('create_hypertable'))).toBe(false);
	});

	it('never reaches for the extension on another dialect', async () => {
		const knex = fakeKnex('sqlite3', true);

		await up(knex);

		// Not even the probe: `pg_extension` does not exist off Postgres, so asking
		// would throw rather than answer false.
		expect(knex.raw).not.toHaveBeenCalled();
	});
});
