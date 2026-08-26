import { describe, expect, it, vi } from 'vitest';
import { down, up } from './20260825B-drop-the-descriptor-url.js';

function fakeKnex() {
	const table = { dropColumn: vi.fn(), text: vi.fn(() => ({ nullable: vi.fn() })) };

	return {
		table,
		knex: {
			schema: {
				alterTable: vi.fn(async (_name: string, build: (t: any) => void) => {
					build(table);
				}),
			},
		} as any,
	};
}

describe('dropping the descriptor url', () => {
	it('drops the column from the descriptor dimension', async () => {
		const { knex, table } = fakeKnex();

		await up(knex);

		expect(knex.schema.alterTable).toHaveBeenCalledWith(
			'directus_cache_descriptors',
			expect.any(Function),
		);

		expect(table.dropColumn).toHaveBeenCalledWith('url');
	});

	it('brings the column back empty and nullable', async () => {
		const { knex, table } = fakeKnex();

		await down(knex);

		// Nullable because there is nothing to put in it: the values were only ever
		// path and query joined, and the rows are re-filled by the traffic anyway.
		expect(table.text).toHaveBeenCalledWith('url');
		expect(table.dropColumn).not.toHaveBeenCalled();
	});
});
