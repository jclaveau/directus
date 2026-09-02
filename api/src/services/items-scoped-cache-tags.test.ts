import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Isolate from the real cache module (redis/bus) and force scoped mode on, so readByQuery runs its
// tag-accumulation branch. runAst is the only DB-touching call in the read path; stub it out.
vi.mock('../cache.js', () => ({
	getCache: () => ({ cache: null }),
}));

vi.mock('../scoped-cache.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('../scoped-cache.js')>()),
		purgeScopedCache: vi.fn(),
		scopedCachePurgeEnabled: vi.fn(() => true),
	};
});

vi.mock('../database/run-ast/run-ast.js', () => ({ runAst: vi.fn(async () => []) }));

import { scopedCachePurgeEnabled } from '../scoped-cache.js';
import { runAst } from '../database/run-ast/run-ast.js';
import { readMeta } from '../utils/read-meta.js';
import { ItemsService } from './items.js';

const schema = new SchemaBuilder()
	.collection('articles', (c) => {
		c.field('id').id();
		c.field('title').string();
		c.field('author').m2o('users');
	})
	.collection('users', (c) => {
		c.field('id').id();
		c.field('name').string();
	})
	.build();

const db = knex({ client: MockClient });

describe('readByQuery scoped cache tag accumulation', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(scopedCachePurgeEnabled).mockReturnValue(true);
	});

	test('tags the root collection AND every collection reached through relations', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		const result = await service.readByQuery({ fields: ['*', 'author.*'] }, { emitEvents: false });

		expect(
			(readMeta(result)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles', 'users']);
	});

	test('tags only the root collection for a non-relational read', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		const result = await service.readByQuery({ fields: ['*'] }, { emitEvents: false });

		expect(
			(readMeta(result)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles']);
	});

	test('tags are bounded per read — they do not accumulate across reads on one instance', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		const shallow = await service.readByQuery({ fields: ['*'] }, { emitEvents: false });
		const deep = await service.readByQuery({ fields: ['*', 'author.*'] }, { emitEvents: false });

		// Each result carries only its own query's tags — the earlier read is not polluted by the later.
		expect(
			(readMeta(shallow)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles']);

		expect(
			(readMeta(deep)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles', 'users']);
	});

	test('readOne carries the read tags onto the single returned item', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });
		vi.mocked(runAst).mockResolvedValueOnce([{ id: 1, title: 't' }]);

		const one = await service.readOne(1, { fields: ['*', 'author.*'] }, { emitEvents: false });

		expect(
			(readMeta(one)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles', 'users']);
	});

	test('readSingleton carries the read tags onto the returned record', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });
		vi.mocked(runAst).mockResolvedValueOnce([{ id: 1, title: 't' }]);

		const record = await service.readSingleton({ fields: ['*', 'author.*'] }, { emitEvents: false });

		expect(
			(readMeta(record)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles', 'users']);
	});

	test('readSingleton carries the read tags onto the synthesized defaults when empty', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });
		vi.mocked(runAst).mockResolvedValueOnce([]); // no row → readSingleton builds a defaults object

		const defaults = await service.readSingleton({ fields: ['*'] }, { emitEvents: false });

		expect(
			(readMeta(defaults)?.scopedCacheTags ?? []).map((tag) => tag.collection).sort(),
		).toEqual(['articles']);
	});

	test('emits empty tags (but still a meta rider) when scoped purge is disabled', async () => {
		vi.mocked(scopedCachePurgeEnabled).mockReturnValue(false);
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		const result = await service.readByQuery({ fields: ['*', 'author.*'] }, { emitEvents: false });

		expect(readMeta(result)?.scopedCacheTags.length).toBe(0);
	});
});

// The write-side snapshot ran behind a "no scope fields declared" early return until
// the key axis made it run for every mutation, so it now meets collections absent
// from the schema. Every mutation reaching it dereferences that collection first, so
// only a direct call gets here today — the guard is what keeps a caller that stops
// doing so from throwing on `.primary` of undefined.
describe(oneLine`
	the write-side snapshot on a collection the schema does not know
`, () => {
	beforeEach(() => {
		vi.mocked(scopedCachePurgeEnabled).mockReturnValue(true);
	});

	test(oneLine`
		resolves no tag rather than throwing, leaving the bare collection tag
	`, async () => {
		const service = new ItemsService('ghost', {
			knex: db,
			schema,
			accountability: null,
		});

		expect(await service.scopedCache.snapshot([1])).toEqual([]);
	});

	test('resolves the key slice on a collection it does know', async () => {
		const service = new ItemsService('articles', {
			knex: db,
			schema,
			accountability: null,
		});

		expect(await service.scopedCache.snapshot([1])).toEqual([
			{ collection: 'articles', field: 'id', value: 1, type: 'integer' },
		]);
	});
});
