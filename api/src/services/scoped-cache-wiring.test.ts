import { SchemaBuilder } from '@directus/schema-builder';
import type { ScopedCacheTag } from '@directus/types';
import knex, { type Knex } from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockedFunction } from 'vitest';

// Force auto-purge on and route shouldClearCache() to a real (truthy) cache.
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

// Spy purgeCache and force scoped mode; the cache itself just needs to be truthy for shouldClearCache.
const purgeCache = vi.fn();

vi.mock('../cache.js', () => ({
	getCache: () => ({ cache: { clear: vi.fn(), delete: vi.fn() } }),
	purgeCache,
	scopedCachePurgeEnabled: () => true,
}));

const { ItemsService } = await import('./items.js');

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('student').string();
	})
	.build();

// SchemaBuilder doesn't model the cache meta; attach the scope field directly.
schema.collections['test']!.scopedCacheFields = ['student'];

const tagFor = (value: unknown): ScopedCacheTag => ({ collection: 'test', field: 'student', value });
const valueTagsOf = (call: unknown[]) => call[2];

// Drives the purge-tag resolution at every mutation site: which ScopedCacheTags (or null = full flush)
// each mutation hands to purgeCache. The tag-derivation itself is unit-tested in scoped-cache-tags.test.ts;
// this pins the wiring (capture-before-write, old ∪ new, upsert full-flush).
describe('scoped cache wiring (ItemsService mutation → purgeCache value tags)', () => {
	let db: MockedFunction<Knex>;
	let tracker: Tracker;

	beforeAll(() => {
		db = vi.mocked(knex.default({ client: MockClient }));
		tracker = createTracker(db);
	});

	beforeEach(() => {
		tracker.on.any('test').response({});
	});

	afterEach(() => {
		tracker.reset();
		purgeCache.mockClear();
	});

	const service = () => new ItemsService('test', { knex: db, schema });

	it('updateMany purges old ∪ new — a row moved student A→B drops both slices', async () => {
		// captureScopedCacheTags selects the pre-update rows (old = A); the payload sets new = B.
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().updateMany([1], { student: 'B' });

		expect(purgeCache).toHaveBeenCalledTimes(1);
		expect(valueTagsOf(purgeCache.mock.calls[0]!)).toEqual([tagFor('A'), tagFor('B')]);
	});

	it('updateMany that leaves the scope field untouched purges only the captured old slice', async () => {
		tracker.on.select('test').response([{ id: 1, student: 'A' }]);
		tracker.on.update('test').response(1);

		await service().updateMany([1], { name: 'renamed' });

		expect(valueTagsOf(purgeCache.mock.calls[0]!)).toEqual([tagFor('A')]);
	});

	it('deleteMany purges the scope slices of the rows it deleted (captured before delete)', async () => {
		tracker.on.select('test').response([
			{ id: 1, student: 'A' },
			{ id: 2, student: 'B' },
		]);

		tracker.on.delete('test').response(2);

		await service().deleteMany([1, 2]);

		expect(purgeCache).toHaveBeenCalledTimes(1);
		expect(valueTagsOf(purgeCache.mock.calls[0]!)).toEqual([tagFor('A'), tagFor('B')]);
	});

	it('upsertMany full-flushes (null) — the update-subset old values are not cheaply capturable', async () => {
		tracker.on.select('test').response([]);
		tracker.on.insert('test').response([1]);

		await service().upsertMany([{ name: 'a', student: 'A' }]);

		expect(valueTagsOf(purgeCache.mock.calls.at(-1)!)).toBeNull();
	});
});
