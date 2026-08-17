import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	countScopedCacheTagMembers,
	scopedCacheTagLabel,
	serializeScopedCacheTags,
	createScopedCacheCollector,
	dropScopedCacheTagIndex,
	scopedCacheTagKey,
} from './scoped-cache.js';
import { redisConfigAvailable, useRedis } from './redis/index.js';

// hoisted: scoped-cache.ts reads `const env = useEnv()` at module load, before a
// plain `const env` below would be initialised (temporal dead zone).
const env = vi.hoisted(() => {
	return {
		CACHE_AUTO_PURGE_MODE: 'scoped',
		CACHE_STORE: 'redis',
		CACHE_NAMESPACE: 'ns',
	} as Record<string, any>;
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('./redis/index.js');
vi.mock('./emitter.js', () => ({ default: { emitAction: vi.fn() } }));

const pipeline = {
	scard: vi.fn().mockReturnThis(),
	exec: vi.fn(),
};

beforeEach(() => {
	env['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env['CACHE_STORE'] = 'redis';
	vi.mocked(redisConfigAvailable).mockReturnValue(true);
	vi.mocked(useRedis).mockReturnValue({ pipeline: () => pipeline } as any);
});

afterEach(() => {
	vi.clearAllMocks();
});

// The one spelling of a tag that the entry index, the purge index and the dev
// headers all share — if these two drift, a purge stops matching the entries it
// actually dropped and the attribution silently reads zero.
describe('the tag display form', () => {
	it('renders a bare collection and a pinned slice', () => {
		expect(scopedCacheTagLabel({ collection: 'articles' })).toBe('articles');

		expect(scopedCacheTagLabel({
			collection: 'articles',
			field: 'author',
			value: 7,
		})).toBe('articles:author=7');
	});

	it('canonicalises the value the same way the Redis key does', () => {
		// A filter's `true` and a driver's `1` must resolve one slice, not two.
		expect(scopedCacheTagLabel({
			collection: 'slots',
			field: 'active',
			value: 1,
			type: 'boolean',
		})).toBe('slots:active=true');
	});

	it('joins a set for the header form', () => {
		expect(serializeScopedCacheTags([
			{ collection: 'articles' },
			{ collection: 'articles', field: 'author', value: 7 },
		])).toBe('articles, articles:author=7');
	});
});

describe('countScopedCacheTagMembers', () => {
	it('scards each tag set and maps the reply to per-tag counts', async () => {
		pipeline.exec.mockResolvedValue([
			[null, 3],
			[null, 7],
		]);

		const counts = await countScopedCacheTagMembers([
			'articles',
			'articles:id=5',
		]);

		expect(pipeline.scard).toHaveBeenCalledWith('ns:tag:articles');
		expect(pipeline.scard).toHaveBeenCalledWith('ns:tag:articles:id=5');
		expect(counts).toEqual({ 'articles': 3, 'articles:id=5': 7 });
	});

	it('treats a missing pipeline reply as a zero count', async () => {
		pipeline.exec.mockResolvedValue([undefined]);

		expect(await countScopedCacheTagMembers(['orphan'])).toEqual({ orphan: 0 });
	});

	it('returns {} when scoped purging is disabled', async () => {
		env['CACHE_AUTO_PURGE_MODE'] = 'full';

		expect(await countScopedCacheTagMembers(['articles'])).toEqual({});
		expect(pipeline.scard).not.toHaveBeenCalled();
	});

	it('returns {} for an empty tag list', async () => {
		expect(await countScopedCacheTagMembers([])).toEqual({});
		expect(pipeline.scard).not.toHaveBeenCalled();
	});
});

describe('createScopedCacheCollector', () => {
	// A uuid key is where a missing type bites hardest: `canonicalScopedCacheValue`
	// lowercases a `uuid` and leaves an untyped value alone.
	const notesSchema = new SchemaBuilder()
		.collection('notes', (c) => {
			c.field('id')
				.uuid()
				.primary();
		})
		.build();

	it('scopeTo and purgeBy feed one idempotent tag set', () => {
		const { scope, purge, tags } = createScopedCacheCollector();
		const authorSlice = { collection: 'articles', field: 'author', value: 5 };

		scope.scopeTo(authorSlice);
		purge.purgeBy({ ...authorSlice }); // same slice via the other handle → deduped

		expect(tags).toEqual([authorSlice]);
	});

	it('accepts a batch, deduping within it and against prior tags', () => {
		const { scope, tags } = createScopedCacheCollector();
		const authorSlice = { collection: 'articles', field: 'author', value: 5 };
		const authorsTable = { collection: 'authors' };

		scope.scopeTo(authorSlice);
		scope.scopeTo([{ ...authorSlice }, authorsTable, authorsTable]);

		// authorSlice repeats the prior tag, authorsTable appears twice → each once.
		expect(tags).toEqual([authorSlice, authorsTable]);
	});

	it('dedups on the canonical tag key — field order and value type collapse', () => {
		const { scope, purge, tags } = createScopedCacheCollector();

		scope.scopeTo({ collection: 'articles', field: 'author', value: 7 });
		// Same slice: keys in a different order AND the value as a string. A raw JSON
		// compare would keep both; the canonical key collapses them to one.
		purge.purgeBy({ field: 'author', value: '7', collection: 'articles' });

		expect(tags).toHaveLength(1);
	});

	it(oneLine`
		fills a type-less tag's type from the schema — the type is what canonicalizes
		the value, so an uppercase uuid a hook names would otherwise resolve a
		different key from the lowercase one the purge side emits for the same row
	`, () => {
		const upper = '07D1AF3C-4B4E-4D6E-9C2A-2F1E0B8A5C31';
		const { scope, purge, tags } = createScopedCacheCollector(notesSchema);

		scope.scopeTo({ collection: 'notes', field: 'id', value: upper });
		// The spelling the driver hands the purge side for the very same row.
		purge.purgeBy({ collection: 'notes', field: 'id', value: upper.toLowerCase() });

		expect(tags).toEqual([
			{ collection: 'notes', field: 'id', value: upper, type: 'uuid' },
		]);

		expect(scopedCacheTagKey(tags[0]!)).toBe(
			`ns:tag:notes:id=${upper.toLowerCase()}`,
		);
	});

	it(oneLine`
		leaves a tag whose type the hook DID declare alone, and a bare collection tag
		has no field to look up
	`, () => {
		const { scope, tags } = createScopedCacheCollector(notesSchema);

		scope.scopeTo({ collection: 'notes', field: 'id', value: 7, type: 'integer' });
		scope.scopeTo({ collection: 'notes' });

		expect(tags).toEqual([
			{ collection: 'notes', field: 'id', value: 7, type: 'integer' },
			{ collection: 'notes' },
		]);
	});

	it(oneLine`
		leaves a tag naming a collection or field the schema doesn't know untyped
		rather than inventing one
	`, () => {
		const { scope, tags } = createScopedCacheCollector(notesSchema);

		scope.scopeTo({ collection: 'ghosts', field: 'id', value: 'A' });
		scope.scopeTo({ collection: 'notes', field: 'ghost', value: 'A' });

		expect(tags).toEqual([
			{ collection: 'ghosts', field: 'id', value: 'A' },
			{ collection: 'notes', field: 'ghost', value: 'A' },
		]);
	});

	it('records a manuallyPurged scopeTo tag key (anomaly-exempt)', () => {
		const { scope, manuallyPurgedKeys } = createScopedCacheCollector();
		const slice = { collection: 'articles', field: 'author', value: 5 };

		scope.scopeTo(slice, { manuallyPurged: true });

		expect(manuallyPurgedKeys.has(scopedCacheTagKey(slice))).toBe(true);
	});

	it('leaves a plain scopeTo / purgeBy out of the manuallyPurged set', () => {
		const { scope, purge, manuallyPurgedKeys } = createScopedCacheCollector();

		scope.scopeTo({ collection: 'articles', field: 'author', value: 5 });
		purge.purgeBy({ collection: 'authors' });

		expect(manuallyPurgedKeys.size).toBe(0);
	});
});

describe('dropScopedCacheTagIndex', () => {
	it('scans the tag namespace and deletes every index set', async () => {
		const scan = vi.fn()
			.mockResolvedValueOnce(['4', ['ns:tag:articles', 'ns:tag:authors']])
			.mockResolvedValueOnce(['0', ['ns:tag:articles:id=1']]);

		const del = vi.fn();
		vi.mocked(useRedis).mockReturnValue({ scan, del } as any);

		await dropScopedCacheTagIndex();

		expect(scan).toHaveBeenCalledWith('0', 'MATCH', 'ns:tag:*', 'COUNT', 250);
		expect(scan).toHaveBeenCalledWith('4', 'MATCH', 'ns:tag:*', 'COUNT', 250);

		// ONE array argument, never a spread: the SCAN result is unbounded, and
		// spreading it past the stack's headroom throws RangeError.
		expect(del).toHaveBeenCalledWith([
			'ns:tag:articles',
			'ns:tag:authors',
			'ns:tag:articles:id=1',
		]);
	});

	it('no-ops (never DELs an empty list) when nothing matches', async () => {
		const scan = vi.fn().mockResolvedValue(['0', []]);
		const del = vi.fn();
		vi.mocked(useRedis).mockReturnValue({ scan, del } as any);

		await dropScopedCacheTagIndex();

		expect(del).not.toHaveBeenCalled();
	});

	it('no-ops when Redis is unavailable', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		const scan = vi.fn();
		vi.mocked(useRedis).mockReturnValue({ scan } as any);

		await dropScopedCacheTagIndex();

		expect(scan).not.toHaveBeenCalled();
	});
});
