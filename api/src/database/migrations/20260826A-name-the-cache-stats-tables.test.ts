import { describe, expect, it, vi } from 'vitest';
import { down, up } from './20260826A-name-the-cache-stats-tables.js';

const OLD_NAMES = [
	'directus_cache_events',
	'directus_cache_descriptors',
	'directus_cache_anomalies',
	'directus_cache_config_events',
	'directus_cache_purges',
	'directus_scoped_cache_purge_tags',
	'directus_scoped_cache_entry_tags',
];

const NEW_NAMES = OLD_NAMES.map((name) => {
	return name.replace(/^directus_(scoped_)?cache_/, 'directus_cache_stats_');
});

// `present` is the set of tables the database holds; renaming moves a name from
// it to the new one, the way the catalog would answer on a second run.
function fakeKnex(present: string[]) {
	const tables = new Set(present);

	return {
		tables,
		knex: {
			schema: {
				hasTable: vi.fn(async (name: string) => tables.has(name)),
				renameTable: vi.fn(async (from: string, to: string) => {
					tables.delete(from);
					tables.add(to);
				}),
			},
		} as any,
	};
}

describe('naming the cache-stats tables', () => {
	it('takes every table onto the one prefix', async () => {
		const { knex, tables } = fakeKnex(OLD_NAMES);

		await up(knex);

		expect([...tables].sort()).toEqual([...NEW_NAMES].sort());

		// The pair that came in with the scoped-cache purge index rather than with
		// the telemetry is the whole reason there were two prefixes.
		expect(knex.schema.renameTable).toHaveBeenCalledWith(
			'directus_scoped_cache_purge_tags',
			'directus_cache_stats_purge_tags',
		);
	});

	it('leaves a table already under its new name alone', async () => {
		const { knex } = fakeKnex(NEW_NAMES);

		await up(knex);

		expect(knex.schema.renameTable).not.toHaveBeenCalled();
	});

	it('skips a name the install never created', async () => {
		const { knex, tables } = fakeKnex(['directus_cache_events']);

		await up(knex);

		expect([...tables]).toEqual(['directus_cache_stats_events']);
		expect(knex.schema.renameTable).toHaveBeenCalledTimes(1);
	});

	it('does not rename onto a name that is already taken', async () => {
		// Both present: renaming would collide, and the old one is the copy to
		// leave for an operator to look at rather than to throw over.
		const { knex } = fakeKnex([
			'directus_cache_events',
			'directus_cache_stats_events',
		]);

		await up(knex);

		expect(knex.schema.renameTable).not.toHaveBeenCalled();
	});

	it('puts every name back', async () => {
		const { knex, tables } = fakeKnex(NEW_NAMES);

		await down(knex);

		expect([...tables].sort()).toEqual([...OLD_NAMES].sort());
	});
});
