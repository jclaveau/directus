import { afterEach, describe, expect, it, vi } from 'vitest';
import { down, up } from './20261001B-record-the-purge-scans.js';

// Records each column change in order, so what the table gains and loses is
// asserted rather than the fact that an alter was asked for.
function fakeKnex(tables: string[]) {
	const changes: string[] = [];

	function column(kind: string, name: string) {
		changes.push(`${kind} ${name}`);

		const chain: any = {
			nullable: () => (changes[changes.length - 1] += ' nullable', chain),
		};

		return chain;
	}

	const knex: any = {
		schema: {
			hasTable: vi.fn(async (name: string) => tables.includes(name)),
			alterTable: vi.fn(async (table: string, build: (table: any) => void) => {
				changes.push(`alter ${table}`);

				build({
					dropColumn: (name: string) => changes.push(`drop ${name}`),
					string: (name: string) => column('string', name),
					integer: (name: string) => column('integer', name),
				});
			}),
		},
	};

	return { knex, changes };
}

describe('recording the purge scans', () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it('adds the scan columns, nullable so an unmeasured row says so', async () => {
		const { knex, changes } = fakeKnex(['directus_cache_stats_purges']);

		await up(knex);

		expect(changes).toEqual([
			'alter directus_cache_stats_purges',
			'string scan_arms nullable',
			'integer scanned_index_keys nullable',
			'integer scanned_members nullable',
			'integer scan_ms nullable',
		]);
	});

	it('drops the scan columns on the way down', async () => {
		const { knex, changes } = fakeKnex(['directus_cache_stats_purges']);

		await down(knex);

		expect(changes).toEqual([
			'alter directus_cache_stats_purges',
			'drop scan_arms',
			'drop scanned_index_keys',
			'drop scanned_members',
			'drop scan_ms',
		]);
	});

	it('leaves a database without the purges table alone', async () => {
		const { knex, changes } = fakeKnex([]);

		await up(knex);
		await down(knex);

		expect(changes).toEqual([]);
	});
});
