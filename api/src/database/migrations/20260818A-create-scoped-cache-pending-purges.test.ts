import { describe, expect, it, vi } from 'vitest';
import { down, up } from './20260818A-create-scoped-cache-pending-purges.js';

// Records the column definitions rather than stubbing them away, so the shape is
// asserted and not merely the fact that a table was asked for.
function recordingTable(columns: string[]) {
	function column(kind: string, name: string) {
		columns.push(`${kind} ${name}`);

		const chain: any = {
			notNullable: () => (columns[columns.length - 1] += ' notNullable', chain),
			nullable: () => (columns[columns.length - 1] += ' nullable', chain),
			primary: () => (columns[columns.length - 1] += ' primary', chain),
			defaultTo: (value: unknown) =>
				(columns[columns.length - 1] += ` default=${value}`, chain),
		};

		return chain;
	}

	return {
		increments: (name: string) => column('increments', name),
		timestamp: (name: string) => column('timestamp', name),
		string: (name: string) => column('string', name),
		text: (name: string) => column('text', name),
		integer: (name: string) => column('integer', name),
	};
}

function fakeKnex() {
	const columns: string[] = [];
	const dropped: string[] = [];

	return {
		columns,
		dropped,
		schema: {
			createTable: vi.fn(async (_name: string, build: (table: any) => void) => {
				build(recordingTable(columns));
			}),
			dropTableIfExists: vi.fn(async (name: string) => {
				dropped.push(name);
			}),
		},
	} as any;
}

describe('20260818A-create-scoped-cache-pending-purges', () => {
	it('creates the table a failed post-commit purge is recorded in', async () => {
		const knex = fakeKnex();

		await up(knex);

		expect(knex.schema.createTable)
			.toHaveBeenCalledWith(
				'directus_scoped_cache_pending_purges',
				expect.any(Function),
			);

		expect(knex.columns).toEqual([
			'increments id primary',
			'timestamp failed_at notNullable',
			'string mode notNullable',
			// Both nullable on purpose: a `collection` purge carries no tag, and a
			// `namespace` one carries neither.
			'string collection nullable',
			'string scoped_cache_tag nullable',
			'integer attempts notNullable default=0',
			'text last_error nullable',
		]);
	});

	it('drops the table on the way down', async () => {
		const knex = fakeKnex();

		await down(knex);

		expect(knex.dropped).toEqual(['directus_scoped_cache_pending_purges']);
	});
});
