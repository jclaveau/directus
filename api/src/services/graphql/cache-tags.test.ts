import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readMeta, withMeta } from '../../utils/read-meta.js';

// Keep graphql's rule set / error classes real; stub the heavy validate + execute so we can drive
// GraphQLService.execute() without a generated schema.
vi.mock('graphql', async (importOriginal) => {
	const actual = await importOriginal<typeof import('graphql')>();
	return { ...actual, validate: vi.fn(() => []), execute: vi.fn(async () => ({ data: { ok: true } })) };
});

vi.mock('../../utils/get-service.js', () => ({ getService: vi.fn() }));
// Cut the schema-generation import graph (it transitively pulls import-export → stream-json, which
// the worktree can't resolve); getSchema is stubbed per-test anyway.
vi.mock('./schema/index.js', () => ({ generateSchema: vi.fn() }));

import { getService } from '../../utils/get-service.js';
import { GraphQLService } from './index.js';

const db = knex({ client: MockClient });

const makeService = (schema: object) =>
	new GraphQLService({ knex: db, schema: schema as any, accountability: null, scope: 'items' });

describe('GraphQLService cache tags', () => {
	beforeEach(() => vi.clearAllMocks());

	test('read() unions each child read’s tags into the request-level aggregate', async () => {
		const schema = {
			collections: { articles: { singleton: false }, users: { singleton: false }, files: { singleton: false } },
		};

		const gql = makeService(schema);

		vi.mocked(getService).mockReturnValueOnce({
			readByQuery: async () =>
				withMeta([{ id: 1 }], { scopedCacheTags: [{ collection: 'articles' }, { collection: 'users' }] }),
		} as any);

		await gql.read('articles', {});
		expect(gql.scopedCacheTags.map((tag) => tag.collection).sort()).toEqual(['articles', 'users']);

		// a second read on another collection adds to the same per-request union
		vi.mocked(getService).mockReturnValueOnce({
			readByQuery: async () => withMeta([{ id: 2 }], { scopedCacheTags: [{ collection: 'directus_files' }] }),
		} as any);

		await gql.read('files', {});
		expect(gql.scopedCacheTags.map((tag) => tag.collection).sort()).toEqual(['articles', 'directus_files', 'users']);
	});

	test('execute() stamps the unioned tags onto its result via getMeta()', async () => {
		const gql = makeService({});
		vi.spyOn(gql, 'getSchema').mockResolvedValue({} as any);

		gql.scopedCacheTags.push({ collection: 'articles' }, { collection: 'users' });

		const result = await gql.execute({
			document: {} as any,
			variables: {},
			operationName: undefined,
			contextValue: {},
		});

		expect(result.data).toEqual({ ok: true });
		expect((readMeta(result)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort()).toEqual(['articles', 'users']);
	});
});
