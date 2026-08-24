import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	countScopedCacheTagMembers,
	scopedCacheTagLabel,
	serializeScopedCacheTags,
	createScopedCacheCollector,
	dropScopedCacheTagIndex,
	purgeCollectionScopedCache,
	purgeScopedCache,
	scopedCacheTagKey,
	tagScopedCacheKeys,
	scopedCacheCollectionsChangedByOnDelete,
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

vi.mock('./emitter.js', () => {
	return {
		default: {
			emitAction: vi.fn(),
			emitFilter: vi.fn((_event, payload) => payload),
		},
	};
});

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

// The blackbox witness covers the rules end to end against a real database; these
// are the shapes it cannot build — a cycle, a diamond, and a rule-less relation.
describe('scopedCacheCollectionsChangedByOnDelete', () => {
	function cascadeRelation(collection: string, related: string) {
		return {
			collection,
			related_collection: related,
			schema: { on_delete: 'CASCADE' },
		};
	}

	it('walks children and grandchildren', () => {
		const schema = {
			relations: [
				cascadeRelation('child', 'parent'),
				cascadeRelation('grandchild', 'child'),
			],
		} as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'parent'))
		.toEqual(['child', 'grandchild']);
	});

	function nullifyRelation(collection: string, related: string) {
		return {
			collection,
			related_collection: related,
			schema: { on_delete: 'SET NULL' },
		};
	}

	// The rows survive with a nulled FK, so they stay indexed under a slice they have
	// just left — stale in a way a cascade never is.
	it('reports a collection whose foreign key is nulled', () => {
		const schema = { relations: [nullifyRelation('child', 'parent')] } as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'parent'))
		.toEqual(['child']);
	});

	it('stops at a nulled collection, since nothing below it changes', () => {
		const schema = {
			relations: [
				nullifyRelation('child', 'parent'),
				cascadeRelation('grandchild', 'child'),
			],
		} as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'parent'))
		.toEqual(['child']);
	});

	// Reached by SET NULL first, so a shared visited-set would have skipped the walk
	// the cascading path owes it.
	it('still walks a collection a cascade reaches after a nullify', () => {
		const schema = {
			relations: [
				nullifyRelation('child', 'parent'),
				cascadeRelation('child', 'parent'),
				cascadeRelation('grandchild', 'child'),
			],
		} as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'parent'))
		.toEqual(['child', 'grandchild']);
	});

	// The default is nullable here or not, but either way the row keeps its place
	// carrying a foreign key it did not have — the SET NULL shape under another name.
	it('reports a collection whose foreign key is reset to a default', () => {
		const schema = {
			relations: [{
				collection: 'child',
				related_collection: 'parent',
				schema: { on_delete: 'SET DEFAULT' },
			}],
		} as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'parent'))
		.toEqual(['child']);
	});

	it.each(['NO ACTION', 'RESTRICT'])(
		'ignores %s, which refuses the delete',
		(onDeleteRule) => {
			const schema = {
				relations: [{
					collection: 'child',
					related_collection: 'parent',
					schema: { on_delete: onDeleteRule },
				}],
			} as any;

			expect(scopedCacheCollectionsChangedByOnDelete(schema, 'parent'))
			.toEqual([]);
		},
	);

	it('ignores a relation the database defines no rule for', () => {
		const schema = {
			relations: [{ collection: 'child', related_collection: 'parent' }],
		} as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'parent')).toEqual([]);
	});

	// The rows it takes down are its own, and the caller named only the one key, so
	// every other slice of it would stay warm on a tag purge built from that key.
	it('reports itself on a self-referencing cascade, and terminates', () => {
		const schema = { relations: [cascadeRelation('node', 'node')] } as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'node'))
		.toEqual(['node']);
	});

	// Deliberate, and the reason is cost: those rows survive in their slices, and
	// finding which ones moved means scanning by an unindexed foreign key per delete.
	it('leaves itself out when a self-relation only nulls the foreign key', () => {
		const schema = { relations: [nullifyRelation('node', 'node')] } as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'node')).toEqual([]);
	});

	// The rule is reached from ANOTHER collection, so the rows it rewrites are not
	// children of the deleted ones and no scan of this collection would find them.
	it('reports the root when a cascade cycles back through a nullify', () => {
		const schema = {
			relations: [
				cascadeRelation('match', 'team'),
				nullifyRelation('team', 'match'),
			],
		} as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'team'))
		.toEqual(['match', 'team']);
	});

	it('reports the root again when a cascade cycles back into it', () => {
		const schema = {
			relations: [
				cascadeRelation('child', 'parent'),
				cascadeRelation('parent', 'child'),
			],
		} as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'parent'))
		.toEqual(['child', 'parent']);
	});

	it('reports a diamond once and terminates', () => {
		const schema = {
			relations: [
				cascadeRelation('left', 'parent'),
				cascadeRelation('right', 'parent'),
				cascadeRelation('leaf', 'left'),
				cascadeRelation('leaf', 'right'),
			],
		} as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'parent'))
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
	it('records a key whose purge a hook skipped, without adding a tag', () => {
		const { purge, tags, purgeSkippedKeys } = createScopedCacheCollector();

		purge.skipPurgeFor(7);

		expect([...purgeSkippedKeys]).toEqual(['7']);

		// Declaring nothing to purge must not read as declaring a purge: the
		// takeover check keys on the tag count.
		expect(tags).toEqual([]);
	});

	it('keys skipped purges as strings, so a numeric and a string id agree', () => {
		const { purge, purgeSkippedKeys } = createScopedCacheCollector();

		purge.skipPurgeFor(7);
		purge.skipPurgeFor('7');

		expect([...purgeSkippedKeys]).toEqual(['7']);
	});

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

describe('collection slice index', () => {
	it('files a slice tag key under its collection, never a bare one', async () => {
		const indexPipeline = {
			sadd: vi.fn().mockReturnThis(),
			expire: vi.fn().mockReturnThis(),
			exec: vi.fn(),
		};

		vi.mocked(useRedis).mockReturnValue({ pipeline: () => indexPipeline } as any);

		await tagScopedCacheKeys('entry', [
			{ collection: 'articles' },
			{ collection: 'articles', field: 'author', value: 7 },
		]);

		expect(indexPipeline.sadd)
		.toHaveBeenCalledWith('ns:slices:articles', 'ns:tag:articles:author=7');

		// The bare tag is where a collection-wide purge starts, so indexing it would
		// only name a key the purge already holds.
		expect(indexPipeline.sadd)
		.not.toHaveBeenCalledWith('ns:slices:articles', 'ns:tag:articles');
	});

	it('reads a collection purge off the index, not a keyspace scan', async () => {
		const smembers = vi.fn()
			.mockResolvedValueOnce(['ns:tag:articles:author=7'])
			.mockResolvedValue([]);

		const scan = vi.fn();

		vi.mocked(useRedis).mockReturnValue({
			smembers,
			scan,
			del: vi.fn(),
			srem: vi.fn(),
		} as any);

		await purgeCollectionScopedCache({ delete: vi.fn() } as any, 'articles');

		expect(smembers).toHaveBeenCalledWith('ns:slices:articles');
		expect(scan).not.toHaveBeenCalled();
	});

	it('drops a purged slice key from its collection index', async () => {
		const srem = vi.fn();

		vi.mocked(useRedis).mockReturnValue({
			smembers: vi.fn().mockResolvedValue([]),
			del: vi.fn(),
			srem,
		} as any);

		await purgeScopedCache(
			{ delete: vi.fn() } as any,
			'articles',
			[{ collection: 'articles', field: 'author', value: 7 }],
		);

		// An index pruned only wholesale keeps naming keys that are gone.
		expect(srem)
		.toHaveBeenCalledWith('ns:slices:articles', ['ns:tag:articles:author=7']);
	});
});

// `CACHE_SCOPED_TAG_INDEX=sorted-set` files a numeric slice as one member of its
// field's sorted set rather than as its own key. The blackbox suite proves the
// entries a write drops are the same either way; these pin the shape of what
// reaches Redis, which no behavioural test can see.
describe('the sorted-set tag index', () => {
	const sortedPipeline = {
		sadd: vi.fn().mockReturnThis(),
		zadd: vi.fn().mockReturnThis(),
		expire: vi.fn().mockReturnThis(),
		exec: vi.fn(),
	};

	beforeEach(() => {
		env['CACHE_SCOPED_TAG_INDEX'] = 'sorted-set';
		vi.mocked(useRedis).mockReturnValue({ pipeline: () => sortedPipeline } as any);
	});

	afterEach(() => {
		env['CACHE_SCOPED_TAG_INDEX'] = 'key-per-value';
	});

	it('scores a numeric slice into one set per field', async () => {
		await tagScopedCacheKeys('entry', [
			{ collection: 'articles', field: 'author', value: 7, type: 'integer' },
		]);

		// The member carries its score: members are unique, so filing the bare entry
		// key under a second value would move it rather than add it.
		expect(sortedPipeline.zadd).toHaveBeenCalledWith(
			'ns:tagz:articles:author',
			7,
			'7|entry',
			7,
			'7|entry__expires_at',
		);

		expect(sortedPipeline.sadd)
		.not.toHaveBeenCalledWith(
			'ns:tag:articles:author=7',
			'entry',
			'entry__expires_at',
		);
	});

	it('names the set once in the collection index, not once per value', async () => {
		await tagScopedCacheKeys('entry', [
			{ collection: 'articles', field: 'author', value: 7, type: 'integer' },
			{ collection: 'articles', field: 'author', value: 8, type: 'integer' },
		]);

		expect(sortedPipeline.sadd)
		.toHaveBeenCalledWith('ns:slices:articles', 'ns:tagz:articles:author');

		expect(sortedPipeline.sadd)
		.not.toHaveBeenCalledWith('ns:slices:articles', 'ns:tag:articles:author=7');
	});

	it('expires the set, not a key per value, when a TTL is configured', async () => {
		env['CACHE_TTL'] = '30s';

		try {
			await tagScopedCacheKeys('entry', [
				{ collection: 'articles', field: 'author', value: 7, type: 'integer' },
			]);

			// Twice the TTL, as the safety net against members orphaned by a crash
			// between write and purge — on the set that now holds them.
			expect(sortedPipeline.expire)
			.toHaveBeenCalledWith('ns:tagz:articles:author', 60);
		}
		finally {
			delete env['CACHE_TTL'];
		}
	});

	it('leaves a value with no score in its own key', async () => {
		await tagScopedCacheKeys('entry', [
			{ collection: 'articles', field: 'tenant', value: 'acme', type: 'string' },
		]);

		// A uuid or string has no score to sit at, so the setting cannot apply.
		expect(sortedPipeline.zadd).not.toHaveBeenCalled();

		expect(sortedPipeline.sadd)
		.toHaveBeenCalledWith(
			'ns:tag:articles:tenant=acme',
			'entry',
			'entry__expires_at',
		);
	});

	it('reads one score, and removes only that score', async () => {
		const zrangebyscore = vi.fn()
			.mockResolvedValue(['7|entry', '7|entry__expires_at']);
		const zremrangebyscore = vi.fn();
		const del = vi.fn();
		const cacheDelete = vi.fn().mockResolvedValue(true);

		vi.mocked(useRedis).mockReturnValue({
			smembers: vi.fn().mockResolvedValue([]),
			zrangebyscore,
			zremrangebyscore,
			zrange: vi.fn(),
			del,
			srem: vi.fn(),
		} as any);

		await purgeScopedCache(
			{ delete: cacheDelete } as any,
			'articles',
			[{ collection: 'articles', field: 'author', value: 7, type: 'integer' }],
		);

		expect(zrangebyscore).toHaveBeenCalledWith('ns:tagz:articles:author', 7, 7);
		expect(cacheDelete).toHaveBeenCalledWith('entry');

		// The set holds every other value of the field, so dropping the key would
		// unfile slices nobody purged.
		expect(zremrangebyscore).toHaveBeenCalledWith('ns:tagz:articles:author', 7, 7);
		expect(del).not.toHaveBeenCalledWith(['ns:tagz:articles:author']);
	});

	it('drops the whole set when the collection goes wholesale', async () => {
		const zrange = vi.fn().mockResolvedValue(['7|entry', '8|other']);
		const del = vi.fn();
		const cacheDelete = vi.fn().mockResolvedValue(true);

		vi.mocked(useRedis).mockReturnValue({
			smembers: vi.fn().mockResolvedValue(['ns:tagz:articles:author']),
			zrange,
			zrangebyscore: vi.fn(),
			zremrangebyscore: vi.fn(),
			del,
			srem: vi.fn(),
		} as any);

		await purgeCollectionScopedCache({ delete: cacheDelete } as any, 'articles');

		expect(zrange).toHaveBeenCalledWith('ns:tagz:articles:author', 0, -1);
		expect(cacheDelete).toHaveBeenCalledWith('entry');
		expect(cacheDelete).toHaveBeenCalledWith('other');
		expect(del)
		.toHaveBeenCalledWith(expect.arrayContaining(['ns:tagz:articles:author']));
	});
});

describe('dropScopedCacheTagIndex', () => {
	it('scans both namespaces and deletes every index set', async () => {
		const scan = vi.fn()
			.mockResolvedValueOnce(['4', ['ns:tag:articles', 'ns:tag:authors']])
			.mockResolvedValueOnce(['0', ['ns:tag:articles:id=1']])
			.mockResolvedValueOnce(['0', ['ns:slices:articles']]);

		const del = vi.fn();
		vi.mocked(useRedis).mockReturnValue({ scan, del } as any);

		await dropScopedCacheTagIndex();

		expect(scan).toHaveBeenCalledWith('0', 'MATCH', 'ns:tag:*', 'COUNT', 250);
		expect(scan).toHaveBeenCalledWith('4', 'MATCH', 'ns:tag:*', 'COUNT', 250);

		// The per-collection slice index sits outside `ns:tag:*`, so a flush that
		// scanned only that pattern would leave it naming keys it just dropped.
		expect(scan).toHaveBeenCalledWith('0', 'MATCH', 'ns:slices:*', 'COUNT', 250);

		expect(del).toHaveBeenCalledWith([
			'ns:tag:articles',
			'ns:tag:authors',
			'ns:tag:articles:id=1',
			'ns:slices:articles',
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
