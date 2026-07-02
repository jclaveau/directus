import { oneLine } from '@directus/utils';
import { SchemaBuilder } from '@directus/schema-builder';
import knex, { type Knex } from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockedFunction,
} from 'vitest';

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

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

vi.mock('../cache.js', () => {
	return {
		getCache: () => ({ cache: { clear: vi.fn(), delete: vi.fn() } }),
	};
});

vi.mock('../scoped-cache.js', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('../scoped-cache.js')>()),
		purgeScopedCache: vi.fn(),
		scopedCachePurgeEnabled: () => true,
	};
});

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

// Multi-level chains: the read reaches a collection two relations deep, so the field-map
// walker must recurse past the first hop. cities → countries → continents (m2o) and the
// mirror continents → countries → cities (o2m).
const m2oChain = new SchemaBuilder()
	.collection('cities', (c) => {
		c.field('id').id();
		c.field('country').m2o('countries');
	})
	.collection('countries', (c) => {
		c.field('id').id();
		c.field('continent').m2o('continents');
	})
	.build();

const o2mChain = new SchemaBuilder()
	.collection('continents', (c) => {
		c.field('id').id();
		c.field('countries').o2m('countries', 'continent_id');
	})
	.collection('countries', (c) => {
		c.field('id').id();
		c.field('cities').o2m('cities', 'country_id');
	})
	.build();

// Mixed-type chains: the walker must recurse across a change of relation type between hops,
// not just repeat one type. o2m→m2o, m2o→o2m, and m2m(deep)→m2o off the junction target.
const o2mThenM2o = new SchemaBuilder()
	.collection('authors', (c) => {
		c.field('id').id();
		c.field('books').o2m('books', 'author_id');
	})
	.collection('books', (c) => {
		c.field('id').id();
		c.field('publisher').m2o('publishers');
	})
	.build();

const m2oThenO2m = new SchemaBuilder()
	.collection('reviews', (c) => {
		c.field('id').id();
		c.field('book').m2o('books');
	})
	.collection('books', (c) => {
		c.field('id').id();
		c.field('chapters').o2m('chapters', 'book_id');
	})
	.build();

// m2m('tags') generates the junction `articles_tags_junction`; tags.category adds a further m2o.
const m2mThenM2o = new SchemaBuilder()
	.collection('articles', (c) => {
		c.field('id').id();
		c.field('tags').m2m('tags');
	})
	.collection('tags', (c) => {
		c.field('id').id();
		c.field('category').m2o('categories');
	})
	.build();

// m2a('text') generates the junction `blog_builder`; text.author adds a further m2o off the target.
const m2aThenM2o = new SchemaBuilder()
	.collection('blog', (c) => {
		c.field('id').id();
		c.field('blocks').m2a(['text']);
	})
	.collection('text', (c) => {
		c.field('id').id();
		c.field('author').m2o('authors');
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
		expect(await taggedCollections('cities', m2o, ['*', 'country.*'])).toEqual([
			'cities',
			'countries',
		]);
	});

	it('o2m: tags the root and the related collection', async () => {
		expect(await taggedCollections('countries', o2m, ['*', 'cities.*'])).toEqual([
			'cities',
			'countries',
		]);
	});

	it(oneLine`
		m2m shallow (junction fields only): tags root + junction, not the unread target
	`, async () => {
		// `tags.*` resolves junction rows, not tag data — so the target need not be
		// tagged, but the junction must be (a link add/remove is a junction write
		// that has to invalidate the read).
		expect(await taggedCollections('articles', m2m, ['*', 'tags.*'])).toEqual([
			'articles',
			'articles_tags_junction',
		]);
	});

	it('m2m deep (target fields read): tags root + junction + target', async () => {
		expect(await taggedCollections('articles', m2m, ['*', 'tags.tags_id.*'])).toEqual([
			'articles',
			'articles_tags_junction',
			'tags',
		]);
	});

	it(oneLine`
		m2a shallow (junction only): tags root + junction, not the unread targets
	`, async () => {
		expect(await taggedCollections('blog', m2a, ['*', 'blocks.*'])).toEqual([
			'blog',
			'blog_builder',
		]);
	});

	it(oneLine`
		m2a deep (item:collection fields): tags root + junction + every read target
	`, async () => {
		expect(
			await taggedCollections('blog', m2a, [
				'*',
				'blocks.item:text.*',
				'blocks.item:image.*',
			]),
		).toEqual(['blog', 'blog_builder', 'image', 'text']);
	});

	// A relational path used only in filter/sort (never selected) still tags the
	// related collection: the read's result set depends on that collection, so a
	// write to it must invalidate.
	it('deep filter on a relation (not selected) tags the related collection', async () => {
		const tags = await taggedForQuery('cities', m2o, {
			fields: ['id'],
			filter: { country: { id: { _eq: 1 } } },
		});

		expect(tags).toEqual(['cities', 'countries']);
	});

	it('sort on a relational path (not selected) tags the related collection', async () => {
		const tags = await taggedForQuery('cities', m2o, {
			fields: ['id'],
			sort: ['country.id'],
		});

		expect(tags).toEqual(['cities', 'countries']);
	});

	// Two hops deep: a regression that recursed only one level would drop the leaf
	// collection (`continents` / `cities`) and leave the read stale after a leaf write.
	it('m2o chain (3 levels): tags every collection down the nested path', async () => {
		expect(
			await taggedCollections('cities', m2oChain, ['*', 'country.continent.*']),
		).toEqual(['cities', 'continents', 'countries']);
	});

	it('o2m chain (3 levels): tags every collection down the nested path', async () => {
		expect(
			await taggedCollections('continents', o2mChain, ['*', 'countries.cities.*']),
		).toEqual(['cities', 'continents', 'countries']);
	});

	// A filter nested two relations deep (nothing beyond the root selected) still tags the
	// whole chain — proves the query walker, not just the field walker, recurses past hop one.
	it(oneLine`
		deep filter two relations down tags every collection on the path
	`, async () => {
		const tags = await taggedForQuery('cities', m2oChain, {
			fields: ['id'],
			filter: { country: { continent: { id: { _eq: 1 } } } },
		});

		expect(tags).toEqual(['cities', 'continents', 'countries']);
	});

	it('mixed chain o2m→m2o: tags every collection across the type change', async () => {
		expect(
			await taggedCollections('authors', o2mThenM2o, ['*', 'books.publisher.*']),
		).toEqual(['authors', 'books', 'publishers']);
	});

	it('mixed chain m2o→o2m: tags every collection across the type change', async () => {
		expect(
			await taggedCollections('reviews', m2oThenO2m, ['*', 'book.chapters.*']),
		).toEqual(['books', 'chapters', 'reviews']);
	});

	it(oneLine`
		mixed chain m2m(deep)→m2o: tags root + junction + target + the target's further m2o
	`, async () => {
		expect(
			await taggedCollections('articles', m2mThenM2o, ['*', 'tags.tags_id.category.*']),
		).toEqual(['articles', 'articles_tags_junction', 'categories', 'tags']);
	});

	it(oneLine`
		mixed chain m2a(deep)→m2o: tags root + junction + target + the target's further m2o
	`, async () => {
		expect(
			await taggedCollections('blog', m2aThenM2o, ['*', 'blocks.item:text.author.*']),
		).toEqual(['authors', 'blog', 'blog_builder', 'text']);
	});
});
