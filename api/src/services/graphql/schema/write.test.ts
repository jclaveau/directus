import { SchemaComposer } from 'graphql-compose';
import { describe, expect, test, vi } from 'vitest';

// graphql-compose runs on the CommonJS build of graphql.
vi.mock('graphql', async () => {
	const { createRequire } = await import('node:module');

	return createRequire(import.meta.url)('graphql');
});

vi.mock('../../../bus/index.js', () => ({ useBus: () => ({ subscribe: vi.fn() }) }));
vi.mock('../index.js', () => ({ GraphQLService: vi.fn() }));
vi.mock('../resolvers/mutation.js', () => ({ resolveMutation: vi.fn() }));

vi.mock('./get-types.js', () => {
	return {
		getTypes: (
			composer: SchemaComposer,
			_scope: string,
			_schema: unknown,
			_inconsistentFields: unknown,
			action: string,
		) => {
			return {
				CollectionTypes: {
					articles: composer.createObjectTC({
						name: `${action}_articles`,
						fields: { id: 'ID', title: 'String' },
					}),
				},
			};
		},
	};
});

import type { GraphQLService } from '../index.js';
import type { Schema } from './index.js';
import { getWritableTypes } from './write.js';

describe('getWritableTypes', () => {
	test('an items batch update takes onRepeatedPk, typed by a directus enum', () => {
		const { UpdateCollectionTypes } = getWritableTypes(
			{ scope: 'items' } as unknown as GraphQLService,
			new SchemaComposer(),
			{
				create: { collections: {} },
				update: {
					collections: {
						articles: {
							collection: 'articles',
							singleton: false,
							fields: { title: {} },
						},
					},
				},
				delete: { collections: {} },
			} as unknown as Schema,
			{ create: {}, update: {} } as never,
			{},
		);

		const batchResolver = UpdateCollectionTypes['articles']!
			.getResolver('update_articles_batch');

		const itemsResolver = UpdateCollectionTypes['articles']!
			.getResolver('update_articles_items');

		expect(batchResolver.getArgNames()).toEqual(['data', 'onRepeatedPk']);
		expect(itemsResolver.getArgNames()).toEqual(['ids', 'data', 'onRepeatedPk']);

		expect(batchResolver.getArgTypeName('onRepeatedPk'))
			.toEqual('directus_repeated_pk_answer');
	});

	test('a system batch update takes no onRepeatedPk', () => {
		const { UpdateCollectionTypes } = getWritableTypes(
			{ scope: 'system' } as unknown as GraphQLService,
			new SchemaComposer(),
			{
				create: { collections: {} },
				update: {
					collections: {
						articles: {
							collection: 'articles',
							singleton: false,
							fields: { title: {} },
						},
					},
				},
				delete: { collections: {} },
			} as unknown as Schema,
			{ create: {}, update: {} } as never,
			{},
		);

		expect(UpdateCollectionTypes['articles']!
			.getResolver('update_articles_batch')
			.getArgNames()).toEqual(['data']);

		expect(UpdateCollectionTypes['articles']!
			.getResolver('update_articles_items')
			.getArgNames()).toEqual(['ids', 'data']);
	});
});
