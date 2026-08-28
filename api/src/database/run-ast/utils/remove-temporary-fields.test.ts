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
