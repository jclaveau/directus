import { beforeEach, describe, expect, test, vi } from 'vitest';

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

beforeEach(() => {
	updateBatch.mockClear();
	updateMany.mockClear();
});

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

		expect(updateBatch.mock.calls).toStrictEqual([[
			[{ id: 1 }, { id: 1 }],
			{ onRepeatedPk: 'lastWins', lastWinsSpelling: 'onRepeatedPk: lastWins' },
		]]);
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

		expect(updateMany.mock.calls).toStrictEqual([[
			[1, 1],
			{ status: 'kept' },
			{
				allowFilterCancel: true,
				onRepeatedPk: 'lastWins',
				lastWinsSpelling: 'onRepeatedPk: lastWins',
			},
		]]);
	});

	test('a batch update without onRepeatedPk refuses a row sent twice', async () => {
		await resolveMutation(
			{ scope: 'items', schema: { collections: {} } } as unknown as GraphQLService,
			{ data: [{ id: 1 }] },
			{
				fieldName: 'update_articles_batch',
				fieldNodes: [],
				fragments: {},
				variableValues: {},
			} as unknown as GraphQLResolveInfo,
		);

		expect(updateBatch.mock.calls).toStrictEqual([[
			[{ id: 1 }],
			{ onRepeatedPk: 'refuse', lastWinsSpelling: 'onRepeatedPk: lastWins' },
		]]);
	});

	test('a system batch update names no onRepeatedPk', async () => {
		await resolveMutation(
			{ scope: 'system', schema: { collections: {} } } as unknown as GraphQLService,
			{ data: [{ id: 1 }] },
			{
				fieldName: 'update_users_batch',
				fieldNodes: [],
				fragments: {},
				variableValues: {},
			} as unknown as GraphQLResolveInfo,
		);

		expect(updateBatch.mock.calls).toStrictEqual([[
			[{ id: 1 }],
			{ onRepeatedPk: undefined, lastWinsSpelling: undefined },
		]]);
	});
});
