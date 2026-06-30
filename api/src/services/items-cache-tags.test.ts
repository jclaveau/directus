import { SchemaBuilder } from '@directus/schema-builder';
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

describe('readByQuery cache-tag accumulation', () => {
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
