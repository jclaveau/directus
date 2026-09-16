import { describe, expect, it, vi } from 'vitest';
import { down, up } from './20260916A-create-cache-audits.js';

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
		timestamp: (name: string) => column('timestamp', name),
		string: (name: string, size?: number) => column('string', name, size),
		text: (name: string) => column('text', name),
		integer: (name: string) => column('integer', name),
		json: (name: string) => column('json', name),
		index: (name: string) => indexes.push(name),
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
				'string cache_key nullable',
				'string(8) method nullable',
				'text url nullable',
				'text query nullable',
				// A bare value, not a foreign key: a finding outlives its user.
				'string(36) user_id nullable',
				'string collection nullable',
				'timestamp filled_at nullable',
				'integer age_ms nullable',
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

	it('takes it all back down, findings before runs', async () => {
		const knex = fakeKnex();

		await down(knex);

		expect(knex.tables['directus_settings']!.columns)
			.toEqual(['drop cache_audit_schedule']);

		expect(knex.dropped).toEqual([
			'directus_cache_audit_findings',
			'directus_cache_audits',
		]);
	});
});
