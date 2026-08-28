import type { Item } from '@directus/types';
import { SchemaBuilder } from '@directus/schema-builder';
import { describe, expect, test } from 'vitest';
import type { AST } from '../../../types/ast.js';
import { removeTemporaryFields } from './remove-temporary-fields.js';

const schema = new SchemaBuilder()
	.collection('unit', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('segments').o2m('segment', 'unit');
	})
	.collection('segment', (c) => {
		c.field('id').id();
		c.field('key').string();
	})
	.build();

const ast: AST = {
	type: 'root',
	name: 'unit',
	query: {},
	children: [
		{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [], alias: false },
		{
			type: 'o2m',
			name: 'segment',
			fieldKey: 'segments',
			parentKey: 'id',
			relatedKey: 'id',
			relation: schema.relations[0]!,
			query: {},
			whenCase: [],
			cases: [],
			children: [
				{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [], alias: false },
			],
		},
	],
	cases: [],
} as unknown as AST;

describe('removeTemporaryFields', () => {
	function buildRawItems(): Item[] {
		return [
			{ id: 1, name: 'unprojected', segments: [{ id: 10, key: 'dropped' }] },
		];
	}

	test('keeps only the requested fields, at every level', () => {
		const items = removeTemporaryFields(schema, buildRawItems(), ast, 'id');

		expect(items).toEqual([{ id: 1, segments: [{ id: 10 }] }]);
	});

	test('leaves the caller its own rows, nested ones included', () => {
		// The entry's single copy is what protects these: the walk assigns into the tree
		// it is given, so a caller reusing its rows must not see the projection.
		const rawItems = buildRawItems();

		removeTemporaryFields(schema, rawItems, ast, 'id');

		expect(rawItems).toEqual([
			{ id: 1, name: 'unprojected', segments: [{ id: 10, key: 'dropped' }] },
		]);
	});

	test('returns a tree that shares nothing with the one it was given', () => {
		const rawItems = buildRawItems();

		const items = removeTemporaryFields(schema, rawItems, ast, 'id') as Item[];

		expect(items[0]).not.toBe(rawItems[0]);
		expect(items[0]!['segments'][0]).not.toBe(rawItems[0]!['segments'][0]);
	});
});

// A row reached from several parents is the same object in the result set:
// directus resolves a shared m2o/o2m target once and hands the same reference
// to every parent pointing at it. The walk visits it once per parent, so it has
// to answer the same each time.
describe('a nested row shared by several parents', () => {
	const sharedSchema = new SchemaBuilder()
		.collection('unit', (c) => {
			c.field('id').id();
			c.field('discipline').m2o('discipline');
		})
		.collection('discipline', (c) => {
			c.field('id').id();
			c.field('name').string();
			c.field('segments').o2m('segment', 'discipline');
		})
		.collection('segment', (c) => {
			c.field('id').id();
		})
		.build();

	function relationFrom(collection: string) {
		return sharedSchema.relations.find((r) => r.collection === collection)!;
	}

	// `segments` asks for no scalar field of its own, so the node collapses to its
	// primary key — the case where a second visit reads `.id` off a number.
	const sharedAst = {
		type: 'root',
		name: 'unit',
		query: {},
		cases: [],
		children: [
			{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [], alias: false },
			{
				type: 'm2o',
				name: 'discipline',
				fieldKey: 'discipline',
				parentKey: 'id',
				relatedKey: 'id',
				relation: relationFrom('unit'),
				query: {},
				whenCase: [],
				cases: [],
				children: [
					{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [], alias: false },
					{
						type: 'field',
						name: 'name',
						fieldKey: 'name',
						whenCase: [],
						alias: false,
					},
					{
						type: 'o2m',
						name: 'segment',
						fieldKey: 'segments',
						parentKey: 'id',
						relatedKey: 'id',
						relation: relationFrom('segment'),
						query: {},
						whenCase: [],
						cases: [],
						children: [],
					},
				],
			},
		],
	} as unknown as AST;

	function project(rows: Item[]): Item[] {
		return removeTemporaryFields(sharedSchema, rows, sharedAst, 'id') as Item[];
	}

	function buildSharing(): Item[] {
		const discipline = { id: 3113, name: 'Santé', segments: [{ id: 7 }, { id: 8 }] };

		return [{ id: 1, discipline }, { id: 2, discipline }];
	}

	test('gives every parent the same nested rows', () => {
		const rows = buildSharing();
		const items = project(rows);

		// The parents differ by their own key, so only the shared branch is comparable.
		expect(items[1]!['discipline']).toEqual(items[0]!['discipline']);
	});

	test('collapses the shared row to keys once, not once per parent', () => {
		const rows = buildSharing();
		const items = project(rows);

		// The second parent used to receive [null, null]: the first visit had
		// already replaced the rows with their keys, and reading a key off a
		// number gives undefined.
		expect(items[1]!['discipline'].segments).toEqual([7, 8]);
	});

	test('holds when the same row is repeated inside one array', () => {
		const discipline = { id: 3113, name: 'Santé', segments: [{ id: 7 }, { id: 8 }] };

		const rows: Item[] = [
			{ id: 1, discipline },
			{ id: 2, discipline },
			{ id: 3, discipline },
		];

		const items = project(rows);
		const segments = items.map((i) => i['discipline'].segments);

		expect(segments).toEqual([[7, 8], [7, 8], [7, 8]]);
	});

	test('leaves the shared row itself untouched', () => {
		const rows = buildSharing();

		removeTemporaryFields(sharedSchema, rows, sharedAst, 'id');

		expect(rows[0]!['discipline'].segments).toEqual([{ id: 7 }, { id: 8 }]);
		expect(rows[0]!['discipline']).toBe(rows[1]!['discipline']);
	});
});

// The a2o branch takes the same shape and picks its projection from the parent's
// collection field, so it is only reached through the recursion — with a
// parentItem in hand and no copy of its own.
describe('an a2o node', () => {
	const a2oSchema = new SchemaBuilder()
		.collection('comment', (c) => {
			c.field('id').id();
			c.field('body').string();
		})
		.collection('tag', (c) => {
			c.field('id').id();
		})
		.build();

	const a2oAst = {
		type: 'a2o',
		name: 'item',
		fieldKey: 'item',
		names: ['comment'],
		query: {},
		whenCase: [],
		cases: [],
		relation: { meta: { one_collection_field: 'collection' } },
		children: {
			comment: [
				{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [], alias: false },
				{
					type: 'o2m',
					name: 'tag',
					fieldKey: 'tags',
					parentKey: 'id',
					relatedKey: 'id',
					relation: { collection: 'tag' },
					query: {},
					whenCase: [],
					cases: [],
					children: [],
				},
			],
		},
	} as unknown as AST;

	const parentItem = { collection: 'comment' } as Item;

	test('keeps only the fields the parent collection asked for', () => {
		const rows: Item[] = [{ id: 5, body: 'dropped', tags: [{ id: 1 }] }];

		const items = removeTemporaryFields(a2oSchema, rows, a2oAst, 'id', parentItem);

		expect(items).toEqual([{ id: 5, tags: [1] }]);
	});

	test('answers the same for a row reached twice', () => {
		const shared = { id: 5, body: 'dropped', tags: [{ id: 1 }, { id: 2 }] };

		const items = removeTemporaryFields(
			a2oSchema,
			[shared, shared],
			a2oAst,
			'id',
			parentItem,
		) as Item[];

		expect(items[1]).toEqual(items[0]);
		expect(items[1]!['tags']).toEqual([1, 2]);
	});

	test('leaves the row it was given untouched', () => {
		const shared = { id: 5, body: 'dropped', tags: [{ id: 1 }, { id: 2 }] };

		removeTemporaryFields(a2oSchema, [shared, shared], a2oAst, 'id', parentItem);

		expect(shared.tags).toEqual([{ id: 1 }, { id: 2 }]);
	});
});

// The projection's other inputs, unchanged by the walk above but sharing its exits.
describe('what the projection is built from', () => {
	const plainSchema = new SchemaBuilder()
		.collection('unit', (c) => {
			c.field('id').id();
			c.field('name').string();
		})
		.build();

	test('keeps an alias field, which is picked but never counted as a field', () => {
		const ast = {
			type: 'root',
			name: 'unit',
			query: {},
			cases: [],
			children: [
				{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [], alias: false },
				{
					type: 'field',
					name: 'name',
					fieldKey: 'renamed',
					whenCase: [],
					alias: true,
				},
			],
		} as unknown as AST;

		const rows: Item[] = [{ id: 1, renamed: 'kept', dropped: 'gone' }];

		expect(removeTemporaryFields(plainSchema, rows, ast, 'id'))
			.toEqual([{ id: 1, renamed: 'kept' }]);
	});

	test('keeps the aggregate fields a query asked for', () => {
		const ast = {
			type: 'root',
			name: 'unit',
			query: { aggregate: { count: ['*'] } },
			cases: [],
			children: [],
		} as unknown as AST;

		const rows: Item[] = [{ count: 12, dropped: 'gone' }];

		const items = removeTemporaryFields(plainSchema, rows, ast, 'id');

		expect(items).toEqual([{ count: 12 }]);
	});

	test('collapses an a2o row to its key when nothing was asked of it', () => {
		const a2oSchema = new SchemaBuilder()
			.collection('comment', (c) => {
				c.field('id').id();
			})
			.build();

		const ast = {
			type: 'a2o',
			name: 'item',
			fieldKey: 'item',
			names: ['comment'],
			query: {},
			whenCase: [],
			cases: [],
			relation: { meta: { one_collection_field: 'collection' } },
			children: { comment: [] },
		} as unknown as AST;

		const rows: Item[] = [{ id: 9, body: 'gone' }];
		const parent = { collection: 'comment' } as Item;

		expect(removeTemporaryFields(a2oSchema, rows, ast, 'id', parent)).toEqual([9]);
	});
});

// A relation with nothing on the other side arrives as null, and the walk hands
// it straight back rather than projecting it. Both branches do this.
describe('an empty relation', () => {
	const plainSchema = new SchemaBuilder()
		.collection('unit', (c) => {
			c.field('id').id();
		})
		.build();

	const rootAst = {
		type: 'root',
		name: 'unit',
		query: {},
		cases: [],
		children: [
			{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [], alias: false },
		],
	} as unknown as AST;

	test('comes back as null from the flat branch', () => {
		const empty = null as unknown as Item;
		const item = removeTemporaryFields(plainSchema, empty, rootAst, 'id');

		expect(item).toBeNull();
	});

	test('comes back as null from the a2o branch', () => {
		const a2oAst = {
			type: 'a2o',
			name: 'item',
			fieldKey: 'item',
			names: ['unit'],
			query: {},
			whenCase: [],
			cases: [],
			relation: { meta: { one_collection_field: 'collection' } },
			children: { unit: [] },
		} as unknown as AST;

		const parent = { collection: 'unit' } as Item;

		const empty = null as unknown as Item;

		const item = removeTemporaryFields(plainSchema, empty, a2oAst, 'id', parent);

		expect(item).toBeNull();
	});
});
