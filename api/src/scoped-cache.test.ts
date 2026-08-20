import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	countScopedCacheTagMembers,
	scopedCacheTagLabel,
	serializeScopedCacheTags,
	createScopedCacheCollector,
	dropScopedCacheTagIndex,
	scopedCacheTagKey,
	scopedCacheCascadedCollections,
} from './scoped-cache.js';
import { printableScopedCacheTags } from './utils/printable-scoped-cache-tags.js';
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

	// countScopedCacheTagMembers rebuilds the Redis key from this string and the
	// entry/purge tag rows join on it, so escaping it here would read zero instead.
	it('keeps a null scope byte-identical to its Redis key', () => {
		const nullSlice = {
			collection: 'student_method_range',
			field: 'method',
			value: null,
		};

		expect(scopedCacheTagKey(nullSlice))
		.toBe(`ns:tag:${scopedCacheTagLabel(nullSlice)}`);
	});
});

// A header throws ERR_INVALID_CHAR on a control byte and a Postgres text column
// rejects the NUL, so both exits render the tag through this one escaper.
describe('the exit form', () => {
	it('escapes the NULL token', () => {
		expect(printableScopedCacheTags(serializeScopedCacheTags([
			{ collection: 'student_method_range', field: 'method', value: null },
		]))).toBe('student_method_range:method=%00null');
	});

	it('escapes any control byte a string scope value carries', () => {
		expect(printableScopedCacheTags('articles:slug=a\u001Fb\u007F'))
		.toBe('articles:slug=a%1Fb%7F');
	});

	it('leaves a printable tag list untouched', () => {
		expect(printableScopedCacheTags('articles, articles:author=7'))
		.toBe('articles, articles:author=7');
	});
});

// The blackbox witness covers the parent/child/grandchild walk end to end; these are
// the shapes it cannot build — a self-referencing FK and a diamond.
describe('scopedCacheCascadedCollections', () => {
	function cascade(collection: string, related: string) {
		return {
			collection,
			related_collection: related,
			schema: { on_delete: 'CASCADE' },
		};
	}

	it('walks children and grandchildren', () => {
		const schema = {
			relations: [cascade('child', 'parent'), cascade('grandchild', 'child')],
		} as any;

		expect(scopedCacheCascadedCollections(schema, 'parent'))
		.toEqual(['child', 'grandchild']);
	});

	it('ignores a relation that does not cascade', () => {
		const schema = {
			relations: [{
				collection: 'child',
				related_collection: 'parent',
				schema: { on_delete: 'SET NULL' },
			}],
		} as any;

		expect(scopedCacheCascadedCollections(schema, 'parent')).toEqual([]);
	});

	it('terminates on a self-referencing cascade', () => {
		const schema = { relations: [cascade('node', 'node')] } as any;

		// The collection already purges its own tags, so it is not its own descendant.
		expect(scopedCacheCascadedCollections(schema, 'node')).toEqual([]);
	});

	it('reports a diamond once and terminates', () => {
		const schema = {
			relations: [
				cascade('left', 'parent'),
				cascade('right', 'parent'),
				cascade('leaf', 'left'),
				cascade('leaf', 'right'),
			],
		} as any;

		expect(scopedCacheCascadedCollections(schema, 'parent'))
		.toEqual(['left', 'right', 'leaf']);
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

	it('scards the raw key of a null scope slice', async () => {
		pipeline.exec.mockResolvedValue([[null, 2]]);

		await countScopedCacheTagMembers([scopedCacheTagLabel({
			collection: 'articles',
			field: 'author',
			value: null,
		})]);

		expect(pipeline.scard)
		.toHaveBeenCalledWith('ns:tag:articles:author=\u0000null');
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

		expect(del).toHaveBeenCalledWith(
			'ns:tag:articles',
			'ns:tag:authors',
			'ns:tag:articles:id=1',
		);
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
