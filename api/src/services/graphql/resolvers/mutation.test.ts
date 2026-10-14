import { describe, expect, test, vi } from 'vitest';

vi.mock('../schema/parse-query.js', () => ({ getQuery: vi.fn(async () => ({})) }));

vi.mock('../utils/replace-fragments.js', () => {
	return { replaceFragmentsInSelections: vi.fn(() => []) };
});

const updateBatch = vi.fn(async () => [1]);
const updateMany = vi.fn(async () => [1]);

vi.mock('../../../utils/get-service.js', () => {
	return { getService: vi.fn(() => ({ updateBatch, updateMany })) };
});

import type { GraphQLResolveInfo } from 'graphql';
import type { GraphQLService } from '../index.js';
import { resolveMutation } from './mutation.js';

describe('resolveMutation', () => {
	test('a batch update passes onRepeatedPk to the service', async () => {
		await resolveMutation(
			{ scope: 'items', schema: { collections: {} } } as unknown as GraphQLService,
			{ data: [{ id: 1 }, { id: 1 }], onRepeatedPk: 'lastWins' },
			{
				fieldName: 'update_articles_batch',
				fieldNodes: [],
				fragments: {},
				variableValues: {},
			} as unknown as GraphQLResolveInfo,
		);

		expect(updateBatch).toHaveBeenCalledWith(
			[{ id: 1 }, { id: 1 }],
			{ onRepeatedPk: 'lastWins' },
		);
	});

	test('an update by ids passes onRepeatedPk to the service', async () => {
		await resolveMutation(
			{ scope: 'items', schema: { collections: {} } } as unknown as GraphQLService,
			{ ids: [1, 1], data: { status: 'kept' }, onRepeatedPk: 'lastWins' },
			{
				fieldName: 'update_articles_items',
				fieldNodes: [],
				fragments: {},
				variableValues: {},
			} as unknown as GraphQLResolveInfo,
		);

		expect(updateMany).toHaveBeenCalledWith(
			[1, 1],
			{ status: 'kept' },
			{ allowFilterCancel: true, onRepeatedPk: 'lastWins' },
		);
	});
});
