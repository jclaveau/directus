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

		await service.readByQuery({ fields: ['*', 'author.*'] }, { emitEvents: false });

		expect([...service.cacheTags].sort()).toEqual(['articles', 'users']);
	});

	test('tags only the root collection for a non-relational read', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		await service.readByQuery({ fields: ['*'] }, { emitEvents: false });

		expect([...service.cacheTags]).toEqual(['articles']);
	});

	test('accumulates the union across multiple reads on the same instance', async () => {
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		await service.readByQuery({ fields: ['*'] }, { emitEvents: false });
		await service.readByQuery({ fields: ['*', 'author.*'] }, { emitEvents: false });

		expect([...service.cacheTags].sort()).toEqual(['articles', 'users']);
	});

	test('skips accumulation entirely when scoped purge is disabled', async () => {
		vi.mocked(scopedCachePurgeEnabled).mockReturnValue(false);
		const service = new ItemsService('articles', { knex: db, schema, accountability: null });

		await service.readByQuery({ fields: ['*', 'author.*'] }, { emitEvents: false });

		expect(service.cacheTags.size).toBe(0);
	});
});
