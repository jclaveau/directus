import { describe, expect, it, vi } from 'vitest';
import { down, up } from './20260924B-name-the-cache-stats-pins.js';

// The catalog as the migration reads it: which tables exist, and the columns each
// one holds. A rename moves the name inside that record, so a second run of the
// same migration sees what a second deploy would.
function fakeKnex(columnsByTable: Record<string, string[]>) {
	const held = new Map(
		Object.entries(columnsByTable).map(([table, columns]) => {
			return [table, new Set(columns)];
		}),
	);

	const updates: [string, string, string][] = [];

	const query = (table: string) => {
		let column = '';
		let from = '';

		const builder = {
			where: (name: string, value: string) => {
				column = name;
				from = value;

				return builder;
			},
			update: async (values: Record<string, string>) => {
				updates.push([table, from, values[column] ?? '']);
			},
		};

		return builder;
	};

	const knex = Object.assign(query, {
		schema: {
			hasTable: vi.fn(async (name: string) => held.has(name)),
			hasColumn: vi.fn(async (table: string, name: string) => {
				return held.get(table)?.has(name) === true;
			}),
			renameTable: vi.fn(async (from: string, to: string) => {
				held.set(to, held.get(from)!);
				held.delete(from);
			}),
			alterTable: vi.fn(async (table: string, build: (alter: any) => void) => {
				build({
					renameColumn: (from: string, to: string) => {
						held.get(table)!.delete(from);
						held.get(table)!.add(to);
					},
				});
			}),
		},
	});

	return { knex: knex as any, held, updates };
}

describe('naming the cache stats pins', () => {
	it('takes both fact tables and their column onto the word they hold', async () => {
		const { knex, held } = fakeKnex({
			directus_cache_stats_scoped_purge_tags: ['purge_id', 'scoped_cache_tag'],
			directus_cache_stats_scoped_entry_tags: ['cache_key', 'scoped_cache_tag'],
		});

		await up(knex);

		expect([...held.keys()]).toEqual([
			'directus_cache_stats_scoped_purge_pins',
			'directus_cache_stats_scoped_entry_pins',
		]);

		expect([...held.get('directus_cache_stats_scoped_purge_pins')!])
			.toEqual(['purge_id', 'scoped_cache_pin']);

		expect([...held.get('directus_cache_stats_scoped_entry_pins')!])
			.toEqual(['cache_key', 'scoped_cache_pin']);
	});

	it('renames the count beside the purges and the audit drift column', async () => {
		const { knex, held } = fakeKnex({
			directus_cache_stats_purges: ['purge_id', 'scoped_cache_tag_count'],
			directus_cache_audits: ['id', 'tag_drift'],
			directus_cache_audit_findings: ['id', 'tags', 'replay_tags'],
		});

		await up(knex);

		expect([...held.get('directus_cache_stats_purges')!])
			.toEqual(['purge_id', 'scoped_cache_pin_count']);

		expect([...held.get('directus_cache_audits')!]).toEqual(['id', 'pin_drift']);

		expect([...held.get('directus_cache_audit_findings')!])
			.toEqual(['id', 'pins', 'replay_pins']);
	});

	it('rewrites the verdict and the reason naming the same finding', async () => {
		const { knex, updates } = fakeKnex({
			directus_cache_audit_findings: ['verdict'],
			directus_cache_stats_anomalies: ['reason'],
		});

		await up(knex);

		expect(updates).toEqual([
			['directus_cache_audit_findings', 'tag_drift', 'pin_drift'],
			['directus_cache_stats_anomalies', 'tag_drift', 'pin_drift'],
		]);
	});

	it('leaves a table already under its new name alone', async () => {
		const { knex } = fakeKnex({
			directus_cache_stats_scoped_purge_pins: ['scoped_cache_pin'],
			directus_cache_stats_scoped_entry_pins: ['scoped_cache_pin'],
		});

		await up(knex);

		expect(knex.schema.renameTable).not.toHaveBeenCalled();
		expect(knex.schema.alterTable).not.toHaveBeenCalled();
	});

	it('skips an install whose stats tables were never created', async () => {
		const { knex } = fakeKnex({});

		await up(knex);

		expect(knex.schema.renameTable).not.toHaveBeenCalled();
		expect(knex.schema.hasColumn).not.toHaveBeenCalled();
	});

	it('puts every name back', async () => {
		const { knex, held, updates } = fakeKnex({
			directus_cache_stats_scoped_purge_pins: ['purge_id', 'scoped_cache_pin'],
			directus_cache_stats_scoped_entry_pins: ['cache_key', 'scoped_cache_pin'],
			directus_cache_stats_purges: ['scoped_cache_pin_count'],
			directus_cache_audits: ['pin_drift'],
			directus_cache_audit_findings: ['verdict', 'pins', 'replay_pins'],
		});

		await down(knex);

		expect([...held.keys()]).toEqual([
			'directus_cache_stats_purges',
			'directus_cache_audits',
			'directus_cache_audit_findings',
			'directus_cache_stats_scoped_purge_tags',
			'directus_cache_stats_scoped_entry_tags',
		]);

		expect([...held.get('directus_cache_stats_scoped_purge_tags')!])
			.toEqual(['purge_id', 'scoped_cache_tag']);

		expect([...held.get('directus_cache_audit_findings')!])
			.toEqual(['verdict', 'tags', 'replay_tags']);

		expect(updates).toEqual([
			['directus_cache_audit_findings', 'pin_drift', 'tag_drift'],
		]);
	});
});
