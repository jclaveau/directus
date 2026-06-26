import { SchemaBuilder } from '@directus/schema-builder';
import knex from 'knex';
import { MockClient } from 'knex-mock-client';
import { beforeEach, describe, expect, test, vi } from 'vitest';

// Isolate from the real cache module (redis/bus) and force scoped mode on, so readByQuery runs its
// tag-accumulation branch. runAst is the only DB-touching call in the read path; stub it out.
vi.mock('../cache.js', () => ({
	getCache: () => ({ cache: null }),
	purgeCache: vi.fn(),
	scopedCachePurgeEnabled: vi.fn(() => true),
}));

vi.mock('../database/run-ast/run-ast.js', () => ({ runAst: vi.fn(async () => []) }));

import { scopedCachePurgeEnabled } from '../cache.js';
import { runAst } from '../database/run-ast/run-ast.js';
import { readMeta } from '../utils/read-meta.js';
import { ItemsService } from './items.js';

const tagsOf = (result: object) => [...(readMeta(result)?.cacheTags ?? [])].sort();

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

		expect(tagsOf(result)).toEqual(['articles', 'users']);
	});

	test('tags only the root collection for a non-relational read', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		const result = await service.readByQuery({ fields: ['*'] }, { emitEvents: false });

		expect(tagsOf(result)).toEqual(['articles']);
	});

	test('tags are bounded per read — they do not accumulate across reads on one instance', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		const shallow = await service.readByQuery({ fields: ['*'] }, { emitEvents: false });
		const deep = await service.readByQuery({ fields: ['*', 'author.*'] }, { emitEvents: false });

		// Each result carries only its own query's tags — the earlier read is not polluted by the later.
		expect(tagsOf(shallow)).toEqual(['articles']);
		expect(tagsOf(deep)).toEqual(['articles', 'users']);
	});

	test('readOne / readSingleton carry the read tags onto the single returned value', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });
		vi.mocked(runAst).mockResolvedValueOnce([{ id: 1, title: 't' }]);

		const one = await service.readOne(1, { fields: ['*', 'author.*'] }, { emitEvents: false });

		expect(tagsOf(one)).toEqual(['articles', 'users']);
	});

	test('emits empty tags (but still a meta rider) when scoped purge is disabled', async () => {
		vi.mocked(scopedCachePurgeEnabled).mockReturnValue(false);
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		const result = await service.readByQuery({ fields: ['*', 'author.*'] }, { emitEvents: false });

		expect(readMeta(result)?.cacheTags.size).toBe(0);
	});
});
