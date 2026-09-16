import { oneLine } from '@directus/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { down, up } from './20260916A-create-cache-audits.js';

const dialect = vi.hoisted(() => ({ client: 'postgres' }));

vi.mock('../index.js', () => {
	return { getDatabaseClient: () => dialect.client };
});

// Records the column definitions rather than stubbing them away, so the shape is
// asserted and not merely the fact that a table was asked for.
function recordingTable(columns: string[], indexes: string[]) {
	function column(kind: string, name: string, size?: number) {
		columns.push(size === undefined
			? `${kind} ${name}`
			: `${kind}(${size}) ${name}`);

		const append = (suffix: string) => {
			columns[columns.length - 1] += suffix;

			return chain;
		};

		const chain: any = {
			notNullable: () => append(' notNullable'),
			nullable: () => append(' nullable'),
			unsigned: () => append(' unsigned'),
			defaultTo: (value: unknown) => append(` default=${value}`),
			references: (target: string) => append(` references=${target}`),
			inTable: (table: string) => append(`@${table}`),
			onDelete: (action: string) => append(` onDelete=${action}`),
		};

		return chain;
	}

	return {
		increments: (name: string) => column('increments', name),
		timestamp: (name: string, options?: { precision: number }) => {
			return column(
				options === undefined
					? 'timestamp'
					: `timestamp(${options.precision})`,
				name,
			);
		},
		string: (name: string, size?: number) => column('string', name, size),
		text: (name: string) => column('text', name),
		integer: (name: string) => column('integer', name),
		json: (name: string) => column('json', name),
		boolean: (name: string) => column('boolean', name),
		index: (columns: string | string[], name?: string) => {
			indexes.push(name ?? (columns as string));
		},
		dropIndex: (_columns: string[], name: string) => indexes.push(`drop ${name}`),
		dropColumn: (name: string) => columns.push(`drop ${name}`),
	};
}

function fakeKnex() {
	const tables: Record<string, { columns: string[]; indexes: string[] }> = {};
	const dropped: string[] = [];

	const build = async (name: string, define: (table: any) => void) => {
		const recorded = tables[name] ?? { columns: [], indexes: [] };
		tables[name] = recorded;
		define(recordingTable(recorded.columns, recorded.indexes));
	};

	return {
		tables,
		dropped,
		raw: vi.fn(),
		schema: {
			createTable: vi.fn(build),
			alterTable: vi.fn(build),
			dropTable: vi.fn(async (name: string) => {
				dropped.push(name);
			}),
		},
	} as any;
}

describe('20260916A-create-cache-audits', () => {
	beforeEach(() => {
		dialect.client = 'postgres';
	});

	it('creates one row per run, one column per verdict', async () => {
		const knex = fakeKnex();

		await up(knex);

		expect(knex.tables['directus_cache_audits']).toEqual({
			columns: [
				'increments id',
				'timestamp started_at notNullable',
				// Null while the run is in flight, or forever if its process died.
				'timestamp finished_at nullable',
				'string(8) trigger notNullable',
				'json options notNullable',
				'integer scanned notNullable default=0',
				'integer fresh notNullable default=0',
				'integer stale notNullable default=0',
				'integer tag_drift notNullable default=0',
				'integer raced notNullable default=0',
				'integer time_varying notNullable default=0',
				'integer expired notNullable default=0',
				'integer unreplayable notNullable default=0',
				'integer evicted notNullable default=0',
				'integer duration_ms nullable',
				// Stopped on CACHE_AUDIT_MAX_DURATION with entries left.
				'boolean timed_out notNullable default=false',
				'text error nullable',
			],
			indexes: ['started_at'],
		});
	});

	it('creates one row per non-fresh finding, cascading with its run', async () => {
		const knex = fakeKnex();

		await up(knex);

		expect(knex.tables['directus_cache_audit_findings']).toEqual({
			columns: [
				'increments id',
				'integer audit unsigned notNullable references=id@directus_cache_audits'
				+ ' onDelete=CASCADE',
				'string(16) verdict notNullable',
				'string(64) reason nullable',
				'string redis_key notNullable',
				'string cache_key notNullable',
				'string(8) method notNullable',
				'text url notNullable',
				'text query notNullable',
				// A bare value, not a foreign key: a finding outlives its user.
				'string(36) user_id nullable',
				'string collection nullable',
				'timestamp filled_at notNullable',
				'integer age_ms notNullable',
				'json tags notNullable',
				'json replay_tags nullable',
				'json diff nullable',
				'json purges_since_filled nullable',
			],
			indexes: ['audit', 'verdict'],
		});
	});

	it('adds the live schedule to the settings', async () => {
		const knex = fakeKnex();

		await up(knex);

		expect(knex.tables['directus_settings']).toEqual({
			columns: ['string cache_audit_schedule nullable'],
			indexes: [],
		});
	});

	it(oneLine`
		gives the descriptors the audit's place in the cache, indexed on Postgres
		over the expression the queue orders on and only where the entry is held
	`, async () => {
		const knex = fakeKnex();

		await up(knex);

		expect(knex.tables['directus_cache_stats_descriptors']).toEqual({
			columns: [
				'timestamp(3) audited_at nullable',
				'timestamp(3) gone_at nullable',
			],
			indexes: [],
		});

		expect(knex.raw).toHaveBeenCalledWith(
			'CREATE INDEX directus_cache_stats_descriptors_audit_queue '
			+ 'ON directus_cache_stats_descriptors ((CASE WHEN audited_at IS NULL '
			+ 'OR audited_at < last_filled THEN last_filled ELSE audited_at END), '
			+ 'last_filled) WHERE gone_at IS NULL',
		);
	});

	it('indexes the queue plainly on the other dialects', async () => {
		dialect.client = 'sqlite';
		const knex = fakeKnex();

		await up(knex);

		expect(knex.raw).not.toHaveBeenCalled();

		expect(knex.tables['directus_cache_stats_descriptors']!.indexes)
			.toEqual(['directus_cache_stats_descriptors_audit_queue']);
	});

	it('takes it all back down, findings before runs', async () => {
		const knex = fakeKnex();

		await down(knex);

		expect(knex.tables['directus_settings']!.columns)
			.toEqual(['drop cache_audit_schedule']);

		expect(knex.tables['directus_cache_stats_descriptors']).toEqual({
			columns: ['drop audited_at', 'drop gone_at'],
			indexes: ['drop directus_cache_stats_descriptors_audit_queue'],
		});

		expect(knex.dropped).toEqual([
			'directus_cache_audit_findings',
			'directus_cache_audits',
		]);
	});
});
