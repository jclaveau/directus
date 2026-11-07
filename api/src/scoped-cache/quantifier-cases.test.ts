import { SchemaBuilder } from '@directus/schema-builder';
import type { Permission } from '@directus/types';
import { describe, expect, test } from 'vitest';
import type { AST } from '../types/ast.js';
import { scopedCacheAstWithQuantifierCases } from './quantifier-cases.js';

const schema = new SchemaBuilder()
	.collection('project', (c) => {
		c.field('id').id();
		c.field('org').string();
	})
	.collection('link', (c) => {
		c.field('id').id();
		c.field('status').string();
		c.field('project').m2o('project');
	})
	.collection('article', (c) => {
		c.field('id').id();
		c.field('links').o2m('link', 'article');
	})
	.build();

const permissions = [{
	collection: 'link',
	action: 'read',
	fields: ['*'],
	permissions: { status: { _eq: 'open' } },
	validation: null,
	presets: null,
	policy: 'reader',
}] as Permission[];

describe('scopedCacheAstWithQuantifierCases', () => {
	test('hands an AST back untouched for a read with no permissions', () => {
		const ast = {
			type: 'root',
			name: 'article',
			query: { filter: { links: { _some: { id: { _eq: 7 } } } } },
			cases: [],
			children: [],
		} as unknown as AST;

		expect(scopedCacheAstWithQuantifierCases(schema, ast, [])).toBe(ast);
	});

	test('adds the rule of the related rows to the root aggregate rules', () => {
		expect(scopedCacheAstWithQuantifierCases(schema, {
			type: 'root',
			name: 'article',
			query: {},
			cases: [],
			aggregateCases: [{ links: { _some: { id: { _eq: 7 } } } }],
			children: [],
		} as unknown as AST, permissions)).toEqual({
			type: 'root',
			name: 'article',
			query: {},
			cases: [],
			aggregateCases: [{
				links: {
					_some: {
						_and: [{ id: { _eq: 7 } }, { _or: [{ status: { _eq: 'open' } }] }],
					},
				},
			}],
			children: [],
		});
	});

	test('adds it to the aggregate rules of a nested node', () => {
		expect(scopedCacheAstWithQuantifierCases(schema, {
			type: 'root',
			name: 'project',
			query: {},
			cases: [],
			children: [{
				type: 'o2m',
				name: 'article',
				query: {},
				cases: [],
				aggregateCases: [{ links: { _some: { id: { _eq: 7 } } } }],
				children: [],
			}],
		} as unknown as AST, permissions)).toEqual({
			type: 'root',
			name: 'project',
			query: {},
			cases: [],
			children: [{
				type: 'o2m',
				name: 'article',
				query: {},
				cases: [],
				aggregateCases: [{
					links: {
						_some: {
							_and: [{ id: { _eq: 7 } }, { _or: [{ status: { _eq: 'open' } }] }],
						},
					},
				}],
				children: [],
			}],
		});
	});

	test('adds it to the aggregate rules of each collection of an A2O', () => {
		expect(scopedCacheAstWithQuantifierCases(schema, {
			type: 'root',
			name: 'project',
			query: {},
			cases: [],
			children: [{
				type: 'a2o',
				names: ['article'],
				query: { article: {} },
				cases: { article: [] },
				aggregateCases: {
					article: [{ links: { _some: { id: { _eq: 7 } } } }],
				},
				children: { article: [] },
			}],
		} as unknown as AST, permissions)).toEqual({
			type: 'root',
			name: 'project',
			query: {},
			cases: [],
			children: [{
				type: 'a2o',
				names: ['article'],
				query: { article: {} },
				cases: { article: [] },
				aggregateCases: {
					article: [{
						links: {
							_some: {
								_and: [
									{ id: { _eq: 7 } },
									{ _or: [{ status: { _eq: 'open' } }] },
								],
							},
						},
					}],
				},
				children: { article: [] },
			}],
		});
	});

	test('adds the rule of the related rows to the root', () => {
		expect(scopedCacheAstWithQuantifierCases(schema, {
			type: 'root',
			name: 'article',
			query: { filter: { links: { _some: { id: { _eq: 7 } } } } },
			cases: [{ links: { _none: { id: { _eq: 8 } } } }],
			children: [],
		} as unknown as AST, permissions)).toEqual({
			type: 'root',
			name: 'article',
			query: {
				filter: {
					links: {
						_some: {
							_and: [{ id: { _eq: 7 } }, { _or: [{ status: { _eq: 'open' } }] }],
						},
					},
				},
			},
			cases: [{
				links: {
					_none: {
						_and: [{ id: { _eq: 8 } }, { _or: [{ status: { _eq: 'open' } }] }],
					},
				},
			}],
			children: [],
		});
	});

	test('leaves the AST it was handed as it was', () => {
		const ast = {
			type: 'root',
			name: 'article',
			query: { filter: { links: { _some: { id: { _eq: 7 } } } } },
			cases: [],
			children: [],
		} as unknown as AST;

		scopedCacheAstWithQuantifierCases(schema, ast, permissions);

		expect(ast.query.filter).toEqual({ links: { _some: { id: { _eq: 7 } } } });
	});

	test('reaches a quantifier through `_and`, `_or` and an m2o', () => {
		expect(scopedCacheAstWithQuantifierCases(schema, {
			type: 'root',
			name: 'link',
			query: {
				filter: {
					_or: [
						{ article: { links: { _some: { id: { _eq: 7 } } } } },
						{ _and: [{ status: { _eq: 'open' } }] },
					],
				},
			},
			cases: [],
			children: [],
		} as unknown as AST, permissions).query).toEqual({
			filter: {
				_or: [
					{
						article: {
							links: {
								_some: {
									_and: [{ id: { _eq: 7 } }, { _or: [{ status: { _eq: 'open' } }] }],
								},
							},
						},
					},
					{ _and: [{ status: { _eq: 'open' } }] },
				],
			},
		});
	});

	test('keeps a field naming no relation as it was', () => {
		expect(scopedCacheAstWithQuantifierCases(schema, {
			type: 'root',
			name: 'link',
			query: { filter: { unknown_field: { other: { _eq: 1 } } } },
			cases: [],
			children: [],
		} as unknown as AST, permissions).query).toEqual({
			filter: { unknown_field: { other: { _eq: 1 } } },
		});
	});

	test('reads an A2O scope from the key', () => {
		expect(scopedCacheAstWithQuantifierCases(schema, {
			type: 'root',
			name: 'link',
			query: {
				filter: { 'item:article': { links: { _some: { id: { _eq: 7 } } } } },
			},
			cases: [],
			children: [],
		} as unknown as AST, permissions).query).toEqual({
			filter: {
				'item:article': {
					links: {
						_some: {
							_and: [{ id: { _eq: 7 } }, { _or: [{ status: { _eq: 'open' } }] }],
						},
					},
				},
			},
		});
	});

	test('walks every node of the tree', () => {
		const filter = { links: { _some: { id: { _eq: 7 } } } };

		const quantifiedFilter = {
			links: {
				_some: {
					_and: [{ id: { _eq: 7 } }, { _or: [{ status: { _eq: 'open' } }] }],
				},
			},
		};

		expect(scopedCacheAstWithQuantifierCases(schema, {
			type: 'root',
			name: 'article',
			query: {},
			cases: [],
			children: [
				{ type: 'field', name: 'id', fieldKey: 'id' },
				{
					type: 'functionField',
					name: 'links',
					fieldKey: 'links_count',
					relatedCollection: 'article',
					query: { filter },
					cases: [filter],
				},
				{
					type: 'o2m',
					name: 'article',
					fieldKey: 'nested',
					query: { filter },
					cases: [],
					children: [{ type: 'field', name: 'id', fieldKey: 'id' }],
				},
				{
					type: 'a2o',
					names: ['article', 'project'],
					fieldKey: 'item',
					query: { article: { filter } },
					cases: { article: [filter] },
					children: {
						article: [{ type: 'field', name: 'id', fieldKey: 'id' }],
					},
				},
			],
		} as unknown as AST, permissions).children).toEqual([
			{ type: 'field', name: 'id', fieldKey: 'id' },
			{
				type: 'functionField',
				name: 'links',
				fieldKey: 'links_count',
				relatedCollection: 'article',
				query: { filter: quantifiedFilter },
				cases: [quantifiedFilter],
			},
			{
				type: 'o2m',
				name: 'article',
				fieldKey: 'nested',
				query: { filter: quantifiedFilter },
				cases: [],
				children: [{ type: 'field', name: 'id', fieldKey: 'id' }],
			},
			{
				type: 'a2o',
				names: ['article', 'project'],
				fieldKey: 'item',
				query: { article: { filter: quantifiedFilter }, project: {} },
				cases: { article: [quantifiedFilter], project: [] },
				children: {
					article: [{ type: 'field', name: 'id', fieldKey: 'id' }],
					project: [],
				},
			},
		]);
	});
});
