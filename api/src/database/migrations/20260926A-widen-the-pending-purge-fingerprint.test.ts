import { afterEach, describe, expect, it, vi } from 'vitest';
import { down, up } from './20260926A-widen-the-pending-purge-fingerprint.js';

// Records each column definition and each delete, so the type the column lands
// on is asserted rather than the fact that an alter was asked for.
function fakeKnex(tables: string[]) {
	const altered: string[] = [];
	const deleted: string[] = [];

	function column(kind: string, name: string) {
		altered.push(`${kind} ${name}`);

		const chain: any = {
			nullable: () => (altered[altered.length - 1] += ' nullable', chain),
			alter: () => (altered[altered.length - 1] += ' alter', chain),
		};

		return chain;
	}

	const knex: any = vi.fn((table: string) => {
		const query: any = {
			whereRaw: (sql: string, bindings: string[]) => {
				deleted.push(`${table} ${sql} ${bindings.join(',')}`);
				return query;
			},
			delete: async () => 0,
		};

		return query;
	});

	knex.schema = {
		hasTable: vi.fn(async (name: string) => tables.includes(name)),
		alterTable: vi.fn(async (_table: string, build: (table: any) => void) => {
			build({
				text: (name: string) => column('text', name),
				string: (name: string) => column('string', name),
			});
		}),
	};

	return { knex, altered, deleted };
}

describe('widening the pending purge fingerprint', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('takes the column onto text, so a long fingerprint fits', async () => {
		const { knex, altered } = fakeKnex(['directus_scoped_cache_pending_purges']);

		await up(knex);

		expect(knex.schema.alterTable).toHaveBeenCalledWith(
			'directus_scoped_cache_pending_purges',
			expect.any(Function),
		);

		expect(altered).toEqual(['text scoped_cache_fingerprint nullable alter']);
	});

	it('skips an install whose queue table was never created', async () => {
		const { knex } = fakeKnex([]);

		await up(knex);
		await down(knex);

		expect(knex.schema.alterTable).not.toHaveBeenCalled();
	});

	it('drops the rows too long to narrow, then narrows back', async () => {
		const { knex, altered, deleted } = fakeKnex([
			'directus_scoped_cache_pending_purges',
		]);

		await down(knex);

		expect(deleted).toEqual([
			'directus_scoped_cache_pending_purges length(??) > 255 '
			+ 'scoped_cache_fingerprint',
		]);

		expect(altered).toEqual(['string scoped_cache_fingerprint nullable alter']);
	});
});
