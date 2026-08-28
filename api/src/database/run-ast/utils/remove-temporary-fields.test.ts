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
