import { afterEach, describe, expect, it, vi } from 'vitest';
import { down, up } from './20261001A-list-the-pending-purge-fingerprints.js';

// Records each delete and each column change in order, so what the table loses
// and gains is asserted rather than the fact that an alter was asked for.
function fakeKnex(tables: string[]) {
	const changes: string[] = [];

	function column(kind: string, name: string) {
		changes.push(`${kind} ${name}`);

		const chain: any = {
			nullable: () => (changes[changes.length - 1] += ' nullable', chain),
		};

		return chain;
	}

	const knex: any = vi.fn((table: string) => {
		return {
			delete: async () => {
				changes.push(`delete ${table}`);
				return 0;
			},
		};
	});

	knex.schema = {
		hasTable: vi.fn(async (name: string) => tables.includes(name)),
		alterTable: vi.fn(async (_table: string, build: (table: any) => void) => {
			build({
				dropColumn: (name: string) => changes.push(`drop ${name}`),
				json: (name: string) => column('json', name),
				text: (name: string) => column('text', name),
			});
		}),
	};

	return { knex, changes };
}

describe('listing the pending purge fingerprints', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it(
		'drops the recorded rows, then swaps the one-fingerprint column for a list',
		async () => {
			const { knex, changes } = fakeKnex(['directus_scoped_cache_pending_purges']);

			await up(knex);

			expect(changes).toEqual([
				'delete directus_scoped_cache_pending_purges',
				'drop scoped_cache_fingerprint',
				'json scoped_cache_fingerprints nullable',
			]);
		},
	);

	it('swaps the list back for one fingerprint per row on the way down', async () => {
		const { knex, changes } = fakeKnex(['directus_scoped_cache_pending_purges']);

		await down(knex);

		expect(changes).toEqual([
			'delete directus_scoped_cache_pending_purges',
			'drop scoped_cache_fingerprints',
			'text scoped_cache_fingerprint nullable',
		]);
	});

	it('skips an install whose queue table was never created', async () => {
		const { knex, changes } = fakeKnex([]);

		await up(knex);
		await down(knex);

		expect(changes).toEqual([]);
		expect(knex.schema.alterTable).not.toHaveBeenCalled();
	});
});
