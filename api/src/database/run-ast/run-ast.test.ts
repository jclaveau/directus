import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability, Item } from '@directus/types';
import knex, { type Knex } from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, type MockedFunction, vi } from 'vitest';
import emitter from '../../emitter.js';
import type { AST } from '../../types/ast.js';
import { runAst } from './run-ast.js';

vi.mock('../index.js', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
		c.field('name').string();
	})
	.build();

const accountability = { admin: true } as Accountability;

function buildAst(): AST {
	return {
		type: 'root',
		name: 'test',
		query: { fields: ['id', 'name'] },
		children: [
			{ type: 'field', name: 'id', fieldKey: 'id', alias: false, whenCase: [] },
			{ type: 'field', name: 'name', fieldKey: 'name', alias: false, whenCase: [] },
		],
		cases: [],
	};
}

describe('runAst filter events', () => {
	let db: MockedFunction<Knex>;
	let tracker: Tracker;

	beforeAll(() => {
		db = vi.mocked(knex.default({ client: MockClient }));
		tracker = createTracker(db);
	});

	beforeEach(() => {
		tracker.on.select('test').response([{ id: 1, name: 'Original' }]);
	});

	afterEach(() => {
		tracker.reset();
		emitter.offAll();
		vi.clearAllMocks();
	});

	it('emits items.db.select with the pending query builder before it runs', async () => {
		const handler = vi.fn((payload) => payload);
		emitter.onFilter('items.db.select', handler);

		await runAst(buildAst(), schema, accountability, { knex: db });

		expect(handler).toHaveBeenCalledTimes(1);
		const [payload, meta, context] = handler.mock.calls[0]!;
		// The payload is the un-awaited knex query builder, so a hook can still mutate it.
		expect(typeof (payload as { then?: unknown }).then).toBe('function');
		expect(meta).toMatchObject({ event: 'items.db.select', collection: 'test' });
		expect(context).toMatchObject({ schema });
	});

	it('emits items.db.selected with the raw rows and lets a hook replace them', async () => {
		const selectedHandler = vi.fn(() => [{ id: 1, name: 'Replaced' }]);
		emitter.onFilter('items.db.selected', selectedHandler);

		const result = await runAst(buildAst(), schema, accountability, { knex: db });

		expect(selectedHandler).toHaveBeenCalledTimes(1);
		const [payload, meta] = selectedHandler.mock.calls[0]!;
		expect(payload).toEqual([{ id: 1, name: 'Original' }]);
		expect(meta).toMatchObject({ event: 'items.db.selected', collection: 'test' });
		expect((result as Item[])[0]).toMatchObject({ id: 1, name: 'Replaced' });
	});

	it('also emits the collection-scoped event names', async () => {
		const scopedSelect = vi.fn((payload) => payload);
		const scopedSelected = vi.fn((payload) => payload);
		emitter.onFilter('test.db.select', scopedSelect);
		emitter.onFilter('test.db.selected', scopedSelected);

		await runAst(buildAst(), schema, accountability, { knex: db });

		expect(scopedSelect).toHaveBeenCalledTimes(1);
		expect(scopedSelected).toHaveBeenCalledTimes(1);
	});
});
