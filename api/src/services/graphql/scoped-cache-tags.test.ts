import { oneLine } from '@directus/utils';
import { GraphQLError, execute } from 'graphql';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { readMeta, withMeta } from '../../utils/read-meta.js';
import { GraphQLExecutionError } from './errors/index.js';

// Keep graphql's rule set / error classes real; stub the heavy validate + execute so we can drive
// GraphQLService.execute() without a generated schema.
vi.mock('graphql', async (importOriginal) => {
	const actual = await importOriginal<typeof import('graphql')>();

	return {
		...actual,
		validate: vi.fn(() => []),
		execute: vi.fn(async () => ({ data: { ok: true } })),
	};
});

vi.mock('../../utils/get-service.js', () => ({ getService: vi.fn() }));
// Cut the schema-generation import graph (it transitively pulls import-export → stream-json, which
// the worktree can't resolve); getSchema is stubbed per-test anyway.
vi.mock('./schema/index.js', () => ({ generateSchema: vi.fn() }));

import { getService } from '../../utils/get-service.js';
import { GraphQLService } from './index.js';

const db = knex({ client: MockClient });

const makeService = (schema: object) => {
	return new GraphQLService({
		knex: db,
		schema: schema as any,
		accountability: null,
		scope: 'items',
	});
};

describe('GraphQLService scoped cache tags', () => {
	beforeEach(() => vi.clearAllMocks());

	test(oneLine`
		read() unions each child read’s tags into the request-level aggregate
	`, async () => {
		const schema = {
			collections: {
				articles: { singleton: false },
				users: { singleton: false },
				files: { singleton: false },
			},
		};

		const gql = makeService(schema);

		vi.mocked(getService).mockReturnValueOnce({
			readByQuery: async () => {
				return withMeta([{ id: 1 }], {
					scopedCacheTags: [{ collection: 'articles' }, { collection: 'users' }],
				});
			},
		} as any);

		await gql.read('articles', {});

		expect(gql.scopedCacheTags.map((tag) => tag.collection).sort()).toEqual([
			'articles',
			'users',
		]);

		// a second read on another collection adds to the same per-request union
		vi.mocked(getService).mockReturnValueOnce({
			readByQuery: async () => {
				return withMeta([{ id: 2 }], {
					scopedCacheTags: [{ collection: 'directus_files' }],
				});
			},
		} as any);

		await gql.read('files', {});

		expect(gql.scopedCacheTags.map((tag) => tag.collection).sort()).toEqual([
			'articles',
			'directus_files',
			'users',
		]);
	});

	test(oneLine`
		read() keeps the EARLIEST purge counter per collection, so a purge landing
		between two roots is still visible to the post-fill comparison
	`, async () => {
		const gql = makeService({ collections: { articles: { singleton: false } } });

		vi.mocked(getService).mockReturnValueOnce({
			readByQuery: async () => {
				return withMeta([{ id: 1 }], {
					scopedCacheTags: [{ collection: 'articles' }],
					scopedCacheEpochs: { articles: '7', users: '3', '*': '1' },
				});
			},
		} as any);

		await gql.read('articles', {});

		// A later root reading `8` where the first read `7` means a purge of
		// `articles` landed between them. Keeping the later value would compare equal
		// at fill time and cache the response the purge invalidated.
		vi.mocked(getService).mockReturnValueOnce({
			readByQuery: async () => {
				return withMeta([{ id: 2 }], {
					scopedCacheTags: [{ collection: 'articles' }],
					scopedCacheEpochs: { articles: '8', files: null, '*': '2' },
				});
			},
		} as any);

		await gql.read('articles', {});

		expect(gql.scopedCacheEpochs).toEqual({
			articles: '7',
			users: '3',
			files: null,
			'*': '1',
		});
	});

	test(oneLine`
		read() tolerates a child read that carries no counters, leaving the aggregate
		untouched rather than undefined
	`, async () => {
		const gql = makeService({ collections: { articles: { singleton: false } } });

		vi.mocked(getService).mockReturnValueOnce({
			readByQuery: async () => {
				return withMeta([{ id: 1 }], {
					scopedCacheTags: [{ collection: 'articles' }],
				});
			},
		} as any);

		await gql.read('articles', {});

		expect(gql.scopedCacheEpochs).toEqual({});
	});

	test(oneLine`
		execute() stamps the merged counters onto its result, so respond can compare
		them after the fill — without them a /graphql entry is filled unguarded
	`, async () => {
		const gql = makeService({});
		vi.spyOn(gql, 'getSchema').mockResolvedValue({} as any);

		gql.scopedCacheEpochs['articles'] = '7';
		gql.scopedCacheEpochs['*'] = '1';

		const result = await gql.execute({
			document: {} as any,
			variables: {},
			operationName: undefined,
			contextValue: {},
		});

		expect(readMeta(result)?.scopedCacheEpochs).toEqual({
			articles: '7',
			'*': '1',
		});
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

		expect(
			(readMeta(result)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles', 'users']);
	});

	test('execute() wraps a thrown execute() in GraphQLExecutionError', async () => {
		const gql = makeService({});
		vi.spyOn(gql, 'getSchema').mockResolvedValue({} as any);

		vi.mocked(execute).mockRejectedValueOnce(new Error('boom'));

		await expect(
			gql.execute({
				document: {} as any,
				variables: {},
				operationName: undefined,
				contextValue: {},
			}),
		).rejects.toBeInstanceOf(GraphQLExecutionError);
	});

	test('execute() carries result extensions onto the formatted result', async () => {
		const gql = makeService({});
		vi.spyOn(gql, 'getSchema').mockResolvedValue({} as any);

		vi.mocked(execute).mockResolvedValueOnce({
			data: { ok: true },
			extensions: { foo: 1 },
		});

		const result = await gql.execute({
			document: {} as any,
			variables: {},
			operationName: undefined,
			contextValue: {},
		});

		expect(result.extensions).toEqual({ foo: 1 });
	});

	test('upsertSingleton() returns true when no fields are requested', async () => {
		const gql = makeService({});

		const upsertSingleton = vi.fn().mockResolvedValue(undefined);
		const readSingleton = vi.fn();

		vi.mocked(getService).mockReturnValueOnce({ upsertSingleton, readSingleton } as any);

		await expect(gql.upsertSingleton('articles', { foo: 1 }, {})).resolves.toBe(true);
		expect(upsertSingleton).toHaveBeenCalledWith({ foo: 1 });
		// no fields → the read is skipped
		expect(readSingleton).not.toHaveBeenCalled();
	});

	test(oneLine`
		upsertSingleton() reads back the singleton when fields are requested
	`, async () => {
		const gql = makeService({});

		const upsertSingleton = vi.fn().mockResolvedValue(undefined);
		const readSingleton = vi.fn().mockResolvedValue({ id: 1 });

		vi.mocked(getService).mockReturnValueOnce({ upsertSingleton, readSingleton } as any);

		await expect(
			gql.upsertSingleton('articles', { foo: 1 }, { fields: ['id'] }),
		).resolves.toEqual({ id: 1 });

		expect(readSingleton).toHaveBeenCalledWith({ fields: ['id'] });
	});

	test('upsertSingleton() rethrows a service error via formatError', async () => {
		const gql = makeService({});

		vi.mocked(getService).mockReturnValueOnce({
			upsertSingleton: async () => {
				throw new Error('nope');
			},
		} as any);

		await expect(gql.upsertSingleton('articles', {}, {})).rejects.toBeInstanceOf(
			GraphQLError,
		);
	});
});
