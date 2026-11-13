import { describe, expect, it, vi } from 'vitest';
import { down, up } from './20260924A-name-the-pending-purge-fingerprint.js';

// `columns` is what the table holds; renaming moves a name inside it, the way the
// catalog would answer on a second run.
function fakeKnex(tables: string[], columns: string[]) {
	const held = new Set(columns);
	const renamed: [string, string][] = [];

	return {
		held,
		renamed,
		knex: {
			schema: {
				hasTable: vi.fn(async (name: string) => tables.includes(name)),
				hasColumn: vi.fn(async (_table: string, name: string) => held.has(name)),
				alterTable: vi.fn(async (_table: string, build: (table: any) => void) => {
					build({
						renameColumn: (from: string, to: string) => {
							held.delete(from);
							held.add(to);
							renamed.push([from, to]);
						},
					});
				}),
			},
		} as any,
	};
}

describe('naming the pending purge fingerprint', () => {
	it('takes the column onto the word the drain hands back', async () => {
		const { knex, held, renamed } = fakeKnex(
			['directus_scoped_cache_pending_purges'],
			['id', 'mode', 'collection', 'scoped_cache_tag'],
		);

		await up(knex);

		expect([...held])
			.toEqual(['id', 'mode', 'collection', 'scoped_cache_fingerprint']);

		expect(renamed).toEqual([['scoped_cache_tag', 'scoped_cache_fingerprint']]);
	});

	it('leaves a column already under its new name alone', async () => {
		const { knex } = fakeKnex(
			['directus_scoped_cache_pending_purges'],
			['id', 'scoped_cache_fingerprint'],
		);

		await up(knex);

		expect(knex.schema.alterTable).not.toHaveBeenCalled();
	});

	it('skips an install whose queue table was never created', async () => {
		const { knex } = fakeKnex([], ['scoped_cache_tag']);

		await up(knex);

		expect(knex.schema.hasColumn).not.toHaveBeenCalled();
		expect(knex.schema.alterTable).not.toHaveBeenCalled();
	});

	it('does not rename onto a name the table already carries', async () => {
		// Both present: renaming would collide, and the old column is the copy to
		// leave for an operator to look at rather than to throw over.
		const { knex } = fakeKnex(
			['directus_scoped_cache_pending_purges'],
			['scoped_cache_tag', 'scoped_cache_fingerprint'],
		);

		await up(knex);

		expect(knex.schema.alterTable).not.toHaveBeenCalled();
	});

	it('puts the name back', async () => {
		const { knex, held } = fakeKnex(
			['directus_scoped_cache_pending_purges'],
			['id', 'scoped_cache_fingerprint'],
		);

		await down(knex);

		expect([...held]).toEqual(['id', 'scoped_cache_tag']);
	});
});
