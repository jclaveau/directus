import { SchemaBuilder } from '@directus/schema-builder';
import knex, { type Knex } from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

// A scoped-mode read must tag every collection whose DATA feeds the response, so a
// later write to any of them purges the cached entry. These pin that the read-side
// field-map → tag derivation (`collectionsInFieldMap(fieldMapFromAst(ast))`) covers
// every relation type — a regression that silently dropped a relation from the tag
// set would leave reads joining it stale (HIT after a write). Tags come from the AST,
// not the rows, so empty tracker responses are enough.
const env: Record<string, any> = {
	CACHE_AUTO_PURGE: true,
	CACHE_AUTO_PURGE_IGNORE_LIST: [],
	CACHE_NAMESPACE: 'system-cache',
	MAX_BATCH_MUTATION: 100000,
};

vi.mock('@directus/env', () => ({ useEnv: () => env }));

vi.mock('../../src/database/index', () => ({
	default: vi.fn(),
	getDatabaseClient: vi.fn().mockReturnValue('postgres'),
}));

vi.mock('../cache.js', () => ({
	getCache: () => ({ cache: { clear: vi.fn(), delete: vi.fn() } }),
	purgeCache: vi.fn(),
	scopedCachePurgeEnabled: () => true,
}));

const { ItemsService } = await import('./items.js');
const { readMeta } = await import('../utils/read-meta.js');

const m2o = new SchemaBuilder()
	.collection('cities', (c) => {
		c.field('id').id();
		c.field('country').m2o('countries');
	})
	.build();

const o2m = new SchemaBuilder()
	.collection('countries', (c) => {
		c.field('id').id();
		c.field('cities').o2m('cities', 'country_id');
	})
	.build();

// m2m('tags') generates the junction `articles_tags_junction`
// (fields: id, articles_id, tags_id) + `tags`.
const m2m = new SchemaBuilder()
	.collection('articles', (c) => {
		c.field('id').id();
		c.field('tags').m2m('tags');
	})
	.build();

// m2a generates the junction `blog_builder` + the target collections `text` / `image`.
const m2a = new SchemaBuilder()
	.collection('blog', (c) => {
		c.field('id').id();
		c.field('blocks').m2a(['text', 'image']);
	})
	.build();

describe('scoped cache read tagging across relation types', () => {
	let db: MockedFunction<Knex>;
	let tracker: Tracker;

	beforeAll(() => {
		db = vi.mocked(knex.default({ client: MockClient }));
		tracker = createTracker(db);
	});

	beforeEach(() => {
		tracker.on.select(() => true).response([]);
		tracker.on.insert(() => true).response([1]);
	});

	afterEach(() => tracker.reset());

	async function taggedForQuery(collection: string, schema: any, query: any) {
		const service = new ItemsService(collection, { knex: db, schema });
		const result = await service.readByQuery(query);
		const tags = readMeta(result)?.scopedCacheTags ?? [];
		return [...new Set(tags.map((t: any) => t.collection))].sort();
	}

	const taggedCollections = (collection: string, schema: any, fields: string[]) =>
		taggedForQuery(collection, schema, { fields });

	it('m2o: tags the root and the related collection', async () => {
		expect(await taggedCollections('cities', m2o, ['*', 'country.*'])).toEqual(['cities', 'countries']);
	});

	it('o2m: tags the root and the related collection', async () => {
		expect(await taggedCollections('countries', o2m, ['*', 'cities.*'])).toEqual(['cities', 'countries']);
	});

	it('m2m shallow (junction fields only): tags root + junction, not the unread target', async () => {
		// `tags.*` resolves junction rows, not tag data — so the target need not be
		// tagged, but the junction must be (a link add/remove is a junction write
		// that has to invalidate the read).
		expect(await taggedCollections('articles', m2m, ['*', 'tags.*'])).toEqual(['articles', 'articles_tags_junction']);
	});

	it('m2m deep (target fields read): tags root + junction + target', async () => {
		expect(await taggedCollections('articles', m2m, ['*', 'tags.tags_id.*'])).toEqual([
			'articles',
			'articles_tags_junction',
			'tags',
		]);
	});

	it('m2a shallow (junction only): tags root + junction, not the unread targets', async () => {
		expect(await taggedCollections('blog', m2a, ['*', 'blocks.*'])).toEqual(['blog', 'blog_builder']);
	});

	it('m2a deep (item:collection fields): tags root + junction + every read target', async () => {
		expect(await taggedCollections('blog', m2a, ['*', 'blocks.item:text.*', 'blocks.item:image.*'])).toEqual([
			'blog',
			'blog_builder',
			'image',
			'text',
		]);
	});

	// A relational path used only in filter/sort (never selected) still tags the
	// related collection: the read's result set depends on that collection, so a
	// write to it must invalidate.
	it('deep filter on a relation (not selected) tags the related collection', async () => {
		const tags = await taggedForQuery('cities', m2o, { fields: ['id'], filter: { country: { id: { _eq: 1 } } } });
		expect(tags).toEqual(['cities', 'countries']);
	});

	it('sort on a relational path (not selected) tags the related collection', async () => {
		const tags = await taggedForQuery('cities', m2o, { fields: ['id'], sort: ['country.id'] });
		expect(tags).toEqual(['cities', 'countries']);
	});
});
