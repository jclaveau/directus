import { SchemaBuilder } from '@directus/schema-builder';
import type { Filter, Query } from '@directus/types';
import type { A2MNode, AST, M2ONode, O2MNode } from './types/ast.js';
import type {
	CollectionKey,
	FieldMap,
	QueryPath,
} from './permissions/modules/process-ast/types.js';
import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	countScopedCacheTagMembers,
	scopedCacheTagLabel,
	serializeScopedCacheTags,
	createScopedCacheCollector,
	pinnedScopedCacheTagsFromKeyedFilters,
	scopedCacheOwnershipNestedPkPaths,
	pinnedScopedCacheTagsFromM2oParents,
	pinnedScopedCacheTagsFromO2mChildren,
	resolveScopedCacheM2oJoinChainFromPath,
	scopedCacheCollectionsBeyondNestedRows,
	scopedCacheFilterKeyingByCollection,
	scopedCacheMaxPinsPerCollection,
	scopedCacheNestedCollections,
	type ScopedCacheFilterKeying,
	dropScopedCacheTagIndex,
	purgeCollectionScopedCache,
	purgeScopedCache,
	retryPendingScopedCachePurges,
	scopedCacheCollectionsChangedByOnDelete,
	scopedCacheTagKey,
	startScopedCachePurgeRecovery,
	tagScopedCacheKeys,
} from './scoped-cache.js';
import { printableScopedCacheTags } from './utils/printable-scoped-cache-tags.js';
import { redisConfigAvailable, useRedis } from './redis/index.js';
import emitter from './emitter.js';
import { getCache } from './cache.js';
import { useLogger } from './logger/index.js';
import {
	queueCacheAnomaly,
	queueCachePurge,
	readCacheDescriptorForRedisKey,
} from './cache-events.js';
import {
	clearPendingScopedCachePurges,
	countFailedScopedCachePurgeRetry,
	listPendingScopedCachePurges,
	recordPendingScopedCachePurge,
} from './scoped-cache-pending-purges.js';

// hoisted: scoped-cache.ts reads `const env = useEnv()` at module load, before a
// plain `const env` below would be initialised (temporal dead zone).
const env = vi.hoisted(() => {
	return {
		CACHE_AUTO_PURGE_MODE: 'scoped',
		CACHE_STORE: 'redis',
		CACHE_NAMESPACE: 'ns',
		// `useEnv` merges defaults.ts, so the real one always carries this.
		CACHE_SCOPED_MAX_PINS_PER_COLLECTION: 250,
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

vi.mock('./logger/index.js', () => ({ useLogger: vi.fn() }));
vi.mock('./cache.js', () => ({ getCache: vi.fn() }));

vi.mock('./cache-events.js', () => {
	return {
		queueCacheAnomaly: vi.fn(),
		queueCachePurge: vi.fn(),
		readCacheDescriptorForRedisKey: vi.fn(),
	};
});

vi.mock('./scoped-cache-pending-purges.js', () => {
	return {
		clearPendingScopedCachePurges: vi.fn(),
		countFailedScopedCachePurgeRetry: vi.fn(),
		listPendingScopedCachePurges: vi.fn(),
		recordPendingScopedCachePurge: vi.fn(),
	};
});

const pipeline = {
	scard: vi.fn().mockReturnThis(),
	exec: vi.fn(),
};

beforeEach(() => {
	env['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env['CACHE_STORE'] = 'redis';
	env['CACHE_NAMESPACE'] = 'ns';
	vi.mocked(redisConfigAvailable).mockReturnValue(true);
	vi.mocked(useRedis).mockReturnValue({ pipeline: () => pipeline } as any);
	vi.mocked(useLogger).mockReturnValue({ info: vi.fn(), warn: vi.fn() } as any);
	vi.mocked(listPendingScopedCachePurges).mockResolvedValue([]);
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
	// The collector fills a declared tag's missing type from the schema; these cases
	// name collections it does not carry, so their tags pass through as written.
	const emptySchema = new SchemaBuilder().build();

	// A uuid key is where a missing type bites hardest: `canonicalScopedCacheValue`
	// lowercases a `uuid` and leaves an untyped value alone.
	const notesSchema = new SchemaBuilder()
		.collection('notes', (c) => {
			c.field('id')
				.uuid()
				.primary();
		})
		.build();

	it('records a key whose purge a hook skipped, without adding a tag', () => {
		const { purge, tags, purgeSkippedKeys } =
			createScopedCacheCollector(emptySchema);

		purge.skipPurgeFor(7);

		expect([...purgeSkippedKeys]).toEqual(['7']);

		// Declaring nothing to purge must not read as declaring a purge: the
		// takeover check keys on the tag count.
		expect(tags).toEqual([]);
	});

	it('keys skipped purges as strings, so a numeric and a string id agree', () => {
		const { purge, purgeSkippedKeys } = createScopedCacheCollector(emptySchema);

		purge.skipPurgeFor(7);
		purge.skipPurgeFor('7');

		expect([...purgeSkippedKeys]).toEqual(['7']);
	});

	it('scopeTo and purgeBy feed one idempotent tag set', () => {
		const { scope, purge, tags } = createScopedCacheCollector(emptySchema);
		const authorSlice = { collection: 'articles', field: 'author', value: 5 };

		scope.scopeTo(authorSlice);
		purge.purgeBy({ ...authorSlice }); // same slice via the other handle → deduped

		expect(tags).toEqual([authorSlice]);
	});

	it('accepts a batch, deduping within it and against prior tags', () => {
		const { scope, tags } = createScopedCacheCollector(emptySchema);
		const authorSlice = { collection: 'articles', field: 'author', value: 5 };
		const authorsTable = { collection: 'authors' };

		scope.scopeTo(authorSlice);
		scope.scopeTo([{ ...authorSlice }, authorsTable, authorsTable]);

		// authorSlice repeats the prior tag, authorsTable appears twice → each once.
		expect(tags).toEqual([authorSlice, authorsTable]);
	});

	it('dedups on the canonical tag key — field order and value type collapse', () => {
		const { scope, purge, tags } = createScopedCacheCollector(emptySchema);

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
		const { scope, manuallyPurgedKeys } = createScopedCacheCollector(emptySchema);
		const slice = { collection: 'articles', field: 'author', value: 5 };

		scope.scopeTo(slice, { manuallyPurged: true });

		expect(manuallyPurgedKeys.has(scopedCacheTagKey(slice))).toBe(true);
	});

	it('leaves a plain scopeTo / purgeBy out of the manuallyPurged set', () => {
		const { scope, purge, manuallyPurgedKeys } =
			createScopedCacheCollector(emptySchema);

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

		// ONE array argument, never a spread: the SCAN result is unbounded, and
		// spreading it past the stack's headroom throws RangeError.
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

// A purge that failed after its mutation committed is finished later
// (https://github.com/jclaveau/directus/issues/365). What the retry must NOT do is
// as load-bearing as what it does: it drops exactly the targets that were recorded,
// so every slice that was never in doubt stays warm.
describe('retryPendingScopedCachePurges', () => {
	// The drain proves the store can still drop an entry by writing one and reading
	// it back, so every case needs one that round-trips — except the case whose whole
	// subject is a store that cannot.
	const probed = new Map<string, unknown>();

	const cache = {
		clear: vi.fn(),
		delete: vi.fn().mockResolvedValue(true),
		set: vi.fn(async (key: string, value: unknown) => {
			probed.set(key, value);
			return true;
		}),
		get: vi.fn(async (key: string) => probed.get(key)),
	};

	const redis = { smembers: vi.fn(), del: vi.fn(), scan: vi.fn(), srem: vi.fn() };

	beforeEach(() => {
		vi.mocked(getCache).mockReturnValue({ cache } as any);
		vi.mocked(useRedis).mockReturnValue(redis as any);
		redis.smembers.mockResolvedValue([]);
		redis.scan.mockResolvedValue(['0', []]);

		// The shape a deployment with CACHE_STATS off returns for every entry, so a
		// case has to opt IN to being able to name what it recovered.
		vi.mocked(readCacheDescriptorForRedisKey).mockResolvedValue(null);
	});

	it(oneLine`
		rebuilds a recorded label against the namespace in force AT RETRY TIME, so a
		CACHE_NAMESPACE change between the failure and the retry cannot misaim it
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheTags: ['articles:id=1'],
			ids: [7],
		}]);

		redis.smembers.mockResolvedValue(['ns:entry-a']);

		// The label was recorded under `ns`; the process now runs under `other`.
		env['CACHE_NAMESPACE'] = 'other';

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(redis.smembers).toHaveBeenCalledWith('other:tag:articles:id=1');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-a');
		expect(redis.del).toHaveBeenCalledWith(['other:tag:articles:id=1']);
		expect(clearPendingScopedCachePurges).toHaveBeenCalledWith([7]);
	});

	it(oneLine`
		takes every slice the index names for a collection-mode record — it named no
		tag because which slices changed was unresolvable when it failed
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'collection',
			collection: 'articles',
			scopedCacheTags: [],
			ids: [7],
		}]);

		redis.smembers.mockImplementation(async (key: string) => {
			return key === 'ns:slices:articles'
				? ['ns:tag:articles:id=1']
				: [];
		});

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(redis.smembers).toHaveBeenCalledWith('ns:slices:articles');

		expect(redis.del)
			.toHaveBeenCalledWith(['ns:tag:articles', 'ns:tag:articles:id=1']);

		expect(cache.clear).not.toHaveBeenCalled();
	});

	it('flushes the whole namespace for a namespace-mode record', async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'namespace',
			collection: null,
			scopedCacheTags: [],
			ids: [7],
		}]);

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(cache.clear).toHaveBeenCalledOnce();
		expect(redis.del).not.toHaveBeenCalled();
		expect(clearPendingScopedCachePurges).toHaveBeenCalledWith([7]);
	});

	it(oneLine`
		keeps a record whose retry failed again and counts the attempt, then carries on
		to the targets behind it
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheTags: ['articles:id=1'],
				ids: [7],
			},
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheTags: ['articles:id=2'],
				ids: [8],
			},
		]);

		const closed = new Error('Connection is closed.');

		// Fails the DEL rather than the SMEMBERS: the report reads members too, and its
		// own guard swallows a failure there, so injecting it earlier would prove
		// nothing about the purge.
		redis.del.mockRejectedValueOnce(closed);

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(countFailedScopedCachePurgeRetry).toHaveBeenCalledWith([7], closed);
		expect(clearPendingScopedCachePurges).not.toHaveBeenCalledWith([7]);
		expect(clearPendingScopedCachePurges).toHaveBeenCalledWith([8]);
	});

	it(oneLine`
		still purges when naming the stale entries fails — the report is best-effort and
		the purge is the correctness step, so a descriptor read must not gate it
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheTags: ['articles:id=1'],
			ids: [7],
		}]);

		redis.smembers.mockResolvedValue(['ns:entry-a']);

		vi.mocked(readCacheDescriptorForRedisKey)
			.mockRejectedValue(new Error('relation does not exist'));

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-a');
		expect(clearPendingScopedCachePurges).toHaveBeenCalledWith([7]);
		expect(countFailedScopedCachePurgeRetry).not.toHaveBeenCalled();
	});

	it(oneLine`
		keeps a collection-mode record naming no collection instead of deleting it — an
		unpurgeable shape is a failed retry, never a success
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'collection',
			collection: null,
			scopedCacheTags: [],
			ids: [7],
		}]);

		expect(await retryPendingScopedCachePurges()).toBe(0);

		expect(clearPendingScopedCachePurges).not.toHaveBeenCalled();

		expect(countFailedScopedCachePurgeRetry)
			.toHaveBeenCalledWith([7], expect.any(Error));
	});

	it(oneLine`
		counts the rows it dropped, not the targets they collapsed into — an outage
		records one slice once per write that touched it
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheTags: ['articles:id=1'],
			ids: [7, 8, 9],
		}]);

		expect(await retryPendingScopedCachePurges()).toBe(3);
	});

	it(oneLine`
		serializes overlapping drains — a reconnect can fire while one is still running,
		and two of them report the same stale entry twice
	`, async () => {
		// Model the table rather than a fixed reply: the second drain must see what the
		// first one already deleted, which is the whole point of not overlapping.
		let rows = [{
			mode: 'slices' as const,
			collection: 'articles',
			scopedCacheTags: ['articles:id=1'],
			ids: [7],
		}];

		vi.mocked(listPendingScopedCachePurges).mockImplementation(async () => rows);

		vi.mocked(clearPendingScopedCachePurges).mockImplementation(async () => {
			rows = [];
		});

		redis.smembers.mockResolvedValue(['ns:entry-a']);

		vi.mocked(readCacheDescriptorForRedisKey)
			.mockResolvedValue({ cacheKey: 'GET /items/articles/1' } as any);

		const [first, second] = await Promise.all([
			retryPendingScopedCachePurges(),
			retryPendingScopedCachePurges(),
		]);

		expect(queueCacheAnomaly).toHaveBeenCalledOnce();
		expect(first + second).toBe(1);
	});

	it('reads nothing when there is no Redis to retry against', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);

		expect(await retryPendingScopedCachePurges()).toBe(0);
		expect(listPendingScopedCachePurges).not.toHaveBeenCalled();
	});

	it('touches the cache at all only when something is pending', async () => {
		expect(await retryPendingScopedCachePurges()).toBe(0);
		expect(getCache).not.toHaveBeenCalled();
	});

	it('leaves the records in place when the cache itself is off', async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'namespace',
			collection: null,
			scopedCacheTags: [],
			ids: [7],
		}]);

		vi.mocked(getCache).mockReturnValue({ cache: null } as any);

		expect(await retryPendingScopedCachePurges()).toBe(0);
		expect(clearPendingScopedCachePurges).not.toHaveBeenCalled();
	});

	it(oneLine`
		drains at boot, where the entry store has simply never dialed — node-redis
		connects on its first command, so a brand-new client reports neither open nor
		ready, and keying on that flag would retire the boot trigger entirely
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheTags: ['articles:id=1'],
			ids: [7],
		}]);

		redis.smembers.mockResolvedValue(['ns:entry-a']);

		vi.mocked(getCache).mockReturnValue({
			cache: { ...cache, store: { client: { isOpen: false, isReady: false } } },
		} as any);

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-a');
		expect(clearPendingScopedCachePurges).toHaveBeenCalledWith([7]);
	});

	it(oneLine`
		keeps every record while the entry store is still offline — a delete is
		swallowed there, so draining would report a purge that dropped nothing and
		throw away the only rows still pointing at those entries
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheTags: ['articles:id=1'],
			ids: [7],
		}]);

		// What an offline store looks like from here: `@keyv/redis` swallows the
		// rejection, so the write reports success and reads back as nothing.
		vi.mocked(getCache).mockReturnValue({
			cache: { ...cache, get: vi.fn().mockResolvedValue(undefined) },
		} as any);

		expect(await retryPendingScopedCachePurges()).toBe(0);

		expect(clearPendingScopedCachePurges).not.toHaveBeenCalled();
		expect(cache.delete).not.toHaveBeenCalled();

		// Not a failed retry either: nothing was attempted, so counting an attempt
		// would spend the budget of a record that never got its chance.
		expect(countFailedScopedCachePurgeRetry).not.toHaveBeenCalled();
	});

	// Reported here rather than when the purge failed, because the anomaly stream is
	// itself Redis-backed: reporting at failure time reports nothing in the one case
	// worth reporting.
	it(oneLine`
		names each entry it found stale, counting the sidecars that ride the same tag as
		the entry they belong to rather than as two more
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheTags: ['articles:id=1'],
			ids: [7],
		}]);

		redis.smembers.mockResolvedValue([
			'ns:entry-a',
			'ns:entry-a__expires_at',
			'ns:entry-a__tags',
		]);

		vi.mocked(readCacheDescriptorForRedisKey)
			.mockResolvedValue({ cacheKey: 'GET /items/articles/1' } as any);

		await retryPendingScopedCachePurges();

		expect(queueCacheAnomaly).toHaveBeenCalledOnce();

		expect(queueCacheAnomaly).toHaveBeenCalledWith({
			cacheKey: 'GET /items/articles/1',
			reason: 'redis_error',
			detail: 'served stale until a failed purge was retried',
		});
	});

	it(oneLine`
		purges an entry whose descriptor is gone all the same — stats were off when it
		was filled, so it can be dropped but not named
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheTags: ['articles:id=1'],
			ids: [7],
		}]);

		redis.smembers.mockResolvedValue(['ns:entry-a']);
		vi.mocked(readCacheDescriptorForRedisKey).mockResolvedValue(null);

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(queueCacheAnomaly).not.toHaveBeenCalled();
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-a');
	});
});

describe('startScopedCachePurgeRecovery', () => {
	it(oneLine`
		retries at boot and again on every reconnect — those are the two moments a
		previously unreachable Redis can have come back
	`, async () => {
		const on = vi.fn();
		vi.mocked(useRedis).mockReturnValue({ on } as any);

		startScopedCachePurgeRecovery();

		expect(on).toHaveBeenCalledWith('ready', expect.any(Function));
		await vi.waitFor(() => expect(listPendingScopedCachePurges).toHaveBeenCalled());

		on.mock.calls[0]![1]();

		await vi.waitFor(() => {
			expect(listPendingScopedCachePurges).toHaveBeenCalledTimes(2);
		});
	});

	it('registers no listener when there is no Redis config', () => {
		const on = vi.fn();
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		vi.mocked(useRedis).mockReturnValue({ on } as any);

		startScopedCachePurgeRecovery();

		expect(on).not.toHaveBeenCalled();
	});

	it(oneLine`
		logs a retry that throws rather than leaving the rejection unhandled — nothing
		awaits this, so an unhandled one would take the process down
	`, async () => {
		const warn = vi.fn();
		vi.mocked(useLogger).mockReturnValue({ info: vi.fn(), warn } as any);
		vi.mocked(useRedis).mockReturnValue({ on: vi.fn() } as any);

		vi.mocked(listPendingScopedCachePurges)
			.mockRejectedValue(new Error('Connection is closed.'));

		startScopedCachePurgeRecovery();

		await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
	});

	it('reports the count once there was something to finish', async () => {
		const info = vi.fn();
		vi.mocked(useLogger).mockReturnValue({ info, warn: vi.fn() } as any);
		vi.mocked(useRedis).mockReturnValue({ on: vi.fn() } as any);

		// Round-trips, because the drain now proves the store can drop an entry
		// before it clears the records naming them.
		vi.mocked(getCache).mockReturnValue({
			cache: {
				clear: vi.fn(),
				set: vi.fn(),
				get: vi.fn().mockResolvedValue(1),
				delete: vi.fn(),
			},
		} as any);

		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'namespace',
			collection: null,
			scopedCacheTags: [],
			ids: [7],
		}]);

		startScopedCachePurgeRecovery();

		await vi.waitFor(() => {
			expect(info)
				.toHaveBeenCalledWith('[scoped-cache] finished 1 pending purge(s)');
		});
	});
});

// A purge runs AFTER its mutation committed, so by the time it can fail the write
// is durable. Answering 500 would have the client retry a mutation that already
// landed, so the request wins and the purge is recorded to be finished later.
describe('a purge that fails after its mutation committed', () => {
	const cache = { clear: vi.fn(), delete: vi.fn().mockResolvedValue(true) };
	const closed = new Error('Connection is closed.');

	beforeEach(() => {
		vi.mocked(useRedis).mockReturnValue({
			smembers: vi.fn().mockResolvedValue([]),
			del: vi.fn(),
			scan: vi.fn().mockResolvedValue(['0', []]),
			srem: vi.fn(),
		} as any);

		vi.mocked(emitter.emitFilter).mockImplementation(async (_e, tags) => tags);
		cache.clear.mockResolvedValue(undefined);
	});

	it(oneLine`
		records the slices it could not drop, and reports no purge it did not run
	`, async () => {
		vi.mocked(useRedis).mockReturnValue({
			smembers: vi.fn().mockRejectedValue(closed),
		} as any);

		const purged = await purgeScopedCache(cache as any, 'articles', [
			{ collection: 'articles', field: 'id', value: 1 },
		]);

		expect(recordPendingScopedCachePurge).toHaveBeenCalledWith(
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheTags: ['articles', 'articles:id=1'],
			},
			closed,
		);

		// Still answered with the tags the mutation resolved — the caller's dev header
		// names what SHOULD have gone, and the recovery is what makes that true.
		expect(purged).toEqual([
			{ collection: 'articles' },
			{ collection: 'articles', field: 'id', value: 1 },
		]);

		expect(queueCachePurge).not.toHaveBeenCalled();
	});

	it(oneLine`
		records the collection when the slices were unresolvable and reading the
		collection's slice index failed too
	`, async () => {
		vi.mocked(useRedis).mockReturnValue({
			smembers: vi.fn().mockRejectedValue(closed),
		} as any);

		expect(await purgeScopedCache(cache as any, 'articles', null))
			.toEqual([{ collection: 'articles' }]);

		expect(recordPendingScopedCachePurge).toHaveBeenCalledWith(
			{ mode: 'collection', collection: 'articles', scopedCacheTags: [] },
			closed,
		);

		expect(queueCachePurge).not.toHaveBeenCalled();
	});

	it(oneLine`
		records the whole namespace when scoped mode is off and the flush failed
	`, async () => {
		env['CACHE_AUTO_PURGE_MODE'] = 'all';
		cache.clear.mockRejectedValue(closed);

		expect(await purgeScopedCache(cache as any, 'articles', [])).toBeNull();

		expect(recordPendingScopedCachePurge).toHaveBeenCalledWith(
			{ mode: 'namespace', collection: null, scopedCacheTags: [] },
			closed,
		);

		expect(queueCachePurge).not.toHaveBeenCalled();
	});

	it('records nothing, and reports the purge, when it went through', async () => {
		await purgeScopedCache(cache as any, 'articles', [
			{ collection: 'articles', field: 'id', value: 1 },
		]);

		expect(recordPendingScopedCachePurge).not.toHaveBeenCalled();
		expect(queueCachePurge).toHaveBeenCalledOnce();
	});
});

describe('pinnedScopedCacheTagsFromM2oParents', () => {
	// owner <- owned_item <- owned_sub_item, each child naming its parent, so a read
	// rooted at the sub-item reaches both ancestors through M2O hops only.
	const schema = new SchemaBuilder()
		.collection('owner', (c) => {
			c.field('id').id();
			c.field('space').string();
			c.field('owned_items').o2m('owned_item', 'owner');
		})
		.collection('owned_item', (c) => {
			c.field('id').id();
			c.field('name').string();
			c.field('owner').m2o('owner');
			c.field('owned_sub_items').o2m('owned_sub_item', 'owned_item');
		})
		.collection('owned_sub_item', (c) => {
			c.field('id').id();
			c.field('label').string();
			c.field('owned_item').m2o('owned_item');
		})
		.build();

	function fieldMapOf(
		...paths: [QueryPath[number], CollectionKey][]
	): FieldMap {
		return {
			read: new Map(paths.map(([path, collection]) => {
				return [path, { collection, fields: new Set<string>() }];
			})),
			other: new Map(),
		};
	}

	const subItemFieldMap = fieldMapOf(
		['', 'owned_sub_item'],
		['owned_item', 'owned_item'],
		['owned_item.owner', 'owner'],
	);

	it(oneLine`
		pins each nested collection by the parent keys the response carried, deduped
	`, () => {
		// Two sub-items under distinct items but ONE owner: the owner tag must not
		// come out twice, and the item tags must not collapse to one.
		const pinned = pinnedScopedCacheTagsFromM2oParents(
			schema,
			'owned_sub_item',
			subItemFieldMap,
			[
				{
					id: 1,
					label: 'a',
					owned_item: { id: 10, name: 'x', owner: { id: 100, space: 's' } },
				},
				{
					id: 2,
					label: 'b',
					owned_item: { id: 11, name: 'y', owner: { id: 100, space: 's' } },
				},
			],
			new Set<string>(),
		);

		expect(pinned.get('owned_item')).toEqual([
			{ collection: 'owned_item', field: 'id', value: 10, type: 'integer' },
			{ collection: 'owned_item', field: 'id', value: 11, type: 'integer' },
		]);

		expect(pinned.get('owner')).toEqual([
			{ collection: 'owner', field: 'id', value: 100, type: 'integer' },
		]);
	});

	it('leaves the root collection to its own filter', () => {
		const pinned = pinnedScopedCacheTagsFromM2oParents(
			schema,
			'owned_sub_item',
			subItemFieldMap,
			[{ id: 1, label: 'a', owned_item: { id: 10, owner: { id: 100 } } }],
			new Set<string>(),
		);

		expect(pinned.has('owned_sub_item')).toBe(false);
	});

	it('keeps a collection reached across a to-many hop bare', () => {
		// An INSERT into `owned_item` creates a row this read would have listed, and
		// no key tag covers a key that did not exist when the entry was filled.
		const pinned = pinnedScopedCacheTagsFromM2oParents(
			schema,
			'owner',
			fieldMapOf(['', 'owner'], ['owned_items', 'owned_item']),
			[{ id: 100, owned_items: [{ id: 10 }, { id: 11 }] }],
			new Set<string>(),
		);

		expect(pinned.has('owned_item')).toBe(false);
	});

	it(oneLine`
		keeps a collection bare when one of its paths crosses a to-many hop
	`, () => {
		// Reached twice: directly by M2O, and back down the owner's to-many. The
		// weakest path decides, or the read goes stale on an insert.
		const pinned = pinnedScopedCacheTagsFromM2oParents(
			schema,
			'owned_sub_item',
			fieldMapOf(
				['owned_item', 'owned_item'],
				['owned_item.owner.owned_items', 'owned_item'],
			),
			[
				{
					id: 1,
					owned_item: {
						id: 10,
						owner: { id: 100, owned_items: [{ id: 10 }] },
					},
				},
			],
			new Set<string>(),
		);

		expect(pinned.has('owned_item')).toBe(false);
	});

	it('skips a row whose parent link is empty, pinning its siblings', () => {
		const pinned = pinnedScopedCacheTagsFromM2oParents(
			schema,
			'owned_sub_item',
			subItemFieldMap,
			[
				{ id: 1, label: 'a', owned_item: null },
				{ id: 2, label: 'b', owned_item: { id: 11, owner: { id: 100 } } },
			],
			new Set<string>(),
		);

		expect(pinned.get('owned_item')).toEqual([
			{ collection: 'owned_item', field: 'id', value: 11, type: 'integer' },
		]);

		expect(pinned.get('owner')).toEqual([
			{ collection: 'owner', field: 'id', value: 100, type: 'integer' },
		]);
	});

	it('keeps a collection bare when the read nested no row of it', () => {
		// A relation the query only filtered or sorted on reaches the field map but
		// never the payload. Pinning nothing there would list the collection by
		// nothing at all, and no write to it would ever drop the read.
		expect(
			pinnedScopedCacheTagsFromM2oParents(
				schema,
				'owned_sub_item',
				fieldMapOf(['owned_item', 'owned_item']),
				[{ id: 1, owned_item: null }],
				new Set<string>(),
			).has('owned_item'),
		).toBe(false);
	});

	it('falls back to bare when a parent row carries no key', () => {
		// Half a key set pins half the rows and silently serves the rest stale.
		const pinned = pinnedScopedCacheTagsFromM2oParents(
			schema,
			'owned_sub_item',
			fieldMapOf(['owned_item', 'owned_item']),
			[
				{ id: 1, owned_item: { id: 10 } },
				{ id: 2, owned_item: { name: 'y' } },
			],
			new Set<string>(),
		);

		expect(pinned.has('owned_item')).toBe(false);
	});

	it('keeps an A2O bare — its related collection varies per row', () => {
		const a2oSchema = new SchemaBuilder()
			.collection('owner', (c) => {
				c.field('id').id();
			})
			.collection('note', (c) => {
				c.field('id').id();
				c.field('subject').a2o(['owner']);
			})
			.build();

		const pinned = pinnedScopedCacheTagsFromM2oParents(
			a2oSchema,
			'note',
			fieldMapOf(['subject:owner', 'owner']),
			[{ id: 1, 'subject:owner': { id: 100 } }],
			new Set<string>(),
		);

		expect(pinned.has('owner')).toBe(false);
	});

	it(oneLine`
		keeps a collection bare when the read depends on it beyond the rows it nested
	`, () => {
		// The set is what `scopedCacheCollectionsBeyondNestedRows` reports; these
		// rows pin fine on their own, so the exclusion is what decides here.
		expect(
			pinnedScopedCacheTagsFromM2oParents(
				schema,
				'owned_sub_item',
				fieldMapOf(['owned_item', 'owned_item']),
				[{ id: 1, owned_item: { id: 10 } }],
				new Set(['owned_item']),
			).has('owned_item'),
		).toBe(false);
	});

	it('keeps the root bare where a self-relation reaches it at a real path', () => {
		// A self-relation is the only way the root is reached at a path the walk
		// accepts, and those parents are rows the root filter never bounded. The
		// map carries no `''` entry here, so the skip is what decides — through
		// `fieldMapFromAst` that entry is always there and would decide first.
		const selfSchema = new SchemaBuilder()
			.collection('owned_item', (c) => {
				c.field('id').id();
				c.field('parent').m2o('owned_item');
			})
			.build();

		expect(
			pinnedScopedCacheTagsFromM2oParents(
				selfSchema,
				'owned_item',
				fieldMapOf(['parent', 'owned_item']),
				[{ id: 1, parent: { id: 2 } }],
				new Set<string>(),
			).has('owned_item'),
		).toBe(false);
	});

	it('keeps a collection bare when a slot holds the raw key, not a row', () => {
		// Nothing merged a parent in, so the response cannot answer the path and the
		// walk refuses to read a key off a number.
		expect(
			pinnedScopedCacheTagsFromM2oParents(
				schema,
				'owned_sub_item',
				fieldMapOf(['owned_item', 'owned_item']),
				[{ id: 1, owned_item: 10 }],
				new Set<string>(),
			).has('owned_item'),
		).toBe(false);
	});

	describe('past the ceiling', () => {
		// Set low rather than built past the shipped default: it keeps the fixtures
		// readable, and it only degrades if the ceiling is read from the env at all.
		const ceiling = 3;

		beforeEach(() => {
			env['CACHE_SCOPED_MAX_PINS_PER_COLLECTION'] = ceiling;
		});

		afterEach(() => {
			env['CACHE_SCOPED_MAX_PINS_PER_COLLECTION'] = 250;
		});

		const records = Array.from(
			{ length: ceiling + 1 },
			(_unused, index) => {
				return { id: index, owner: { id: index, space: 'shared' } };
			},
		);

		const ownerFieldMap = fieldMapOf(['owner', 'owner']);

		it('degrades to the collection\'s own slices, not to bare', () => {
			const slicedSchema = new SchemaBuilder()
				.collection('owner', (c) => {
					c.field('id').id();
					c.field('space').string();
				})
				.collection('owned_item', (c) => {
					c.field('id').id();
					c.field('owner').m2o('owner');
				})
				.build();

			slicedSchema.collections['owner']!.scopedCacheFields = ['space'];

			const pinned = pinnedScopedCacheTagsFromM2oParents(
				slicedSchema,
				'owned_item',
				ownerFieldMap,
				records,
				new Set<string>(),
			);

			expect(pinned.get('owner')).toEqual([
				{ collection: 'owner', field: 'space', value: 'shared', type: 'string' },
			]);
		});

		it('goes bare when the slices themselves pass the ceiling', () => {
			// One distinct `space` per row, so the fallback is no smaller than the
			// key pin it replaced and buys nothing.
			const slicedSchema = new SchemaBuilder()
				.collection('owner', (c) => {
					c.field('id').id();
					c.field('space').string();
				})
				.collection('owned_item', (c) => {
					c.field('id').id();
					c.field('owner').m2o('owner');
				})
				.build();

			slicedSchema.collections['owner']!.scopedCacheFields = ['space'];

			expect(
				pinnedScopedCacheTagsFromM2oParents(
					slicedSchema,
					'owned_item',
					ownerFieldMap,
					records.map((record, index) => {
						return { ...record, owner: { id: index, space: `s${index}` } };
					}),
					new Set<string>(),
				).has('owner'),
			).toBe(false);
		});

		it('reads only the direct columns of a dotted scope field', () => {
			// `owner.name` names a column on another collection, which the parent row
			// does not carry — reading it off the row would tag a wrong value.
			const dottedSchema = new SchemaBuilder()
				.collection('owner', (c) => {
					c.field('id').id();
					c.field('space').string();
				})
				.collection('owned_item', (c) => {
					c.field('id').id();
					c.field('owner').m2o('owner');
				})
				.build();

			dottedSchema.collections['owner']!.scopedCacheFields = [
				'space',
				'owner.name',
			];

			expect(
				pinnedScopedCacheTagsFromM2oParents(
					dottedSchema,
					'owned_item',
					ownerFieldMap,
					records,
					new Set<string>(),
				).get('owner'),
			).toEqual([
				{
					collection: 'owner',
					field: 'space',
					value: 'shared',
					type: 'string',
				},
			]);
		});

		it('goes bare when the collection declares no slice to fall back on', () => {
			const pinned = pinnedScopedCacheTagsFromM2oParents(
				schema,
				'owned_item',
				ownerFieldMap,
				records,
				new Set<string>(),
			);

			expect(pinned.has('owner')).toBe(false);
		});

		it('still pins the same set exactly at the ceiling', () => {
			// Non-vacuity: the two cases above degrade because of the COUNT, not
			// because this shape was never pinnable.
			const pinned = pinnedScopedCacheTagsFromM2oParents(
				schema,
				'owned_item',
				ownerFieldMap,
				records.slice(0, ceiling),
				new Set<string>(),
			);

			expect(pinned.get('owner')).toHaveLength(ceiling);
		});
	});
});

describe('resolveScopedCacheM2oJoinChainFromPath', () => {
	const schema = new SchemaBuilder()
		.collection('owner', (c) => {
			c.field('id').id();
			c.field('owned_items').o2m('owned_item', 'owner');
		})
		.collection('owned_item', (c) => {
			c.field('id').id();
			c.field('owner').m2o('owner');
			c.field('owned_sub_items').o2m('owned_sub_item', 'owned_item');
		})
		.collection('owned_sub_item', (c) => {
			c.field('id').id();
			c.field('owned_item').m2o('owned_item');
		})
		.build();

	it('resolves a path into the chain of joins it crosses', () => {
		expect(
			resolveScopedCacheM2oJoinChainFromPath(schema, 'owned_sub_item', [
				'owned_item',
				'owner',
			]),
		).toEqual([
			{ field: 'owned_item', relatedCollection: 'owned_item', relatedPk: 'id' },
			{ field: 'owner', relatedCollection: 'owner', relatedPk: 'id' },
		]);
	});

	it('stops at a to-many hop', () => {
		expect(
			resolveScopedCacheM2oJoinChainFromPath(schema, 'owned_item', [
				'owned_sub_items',
			]),
		).toBe(null);
	});

	it('stops at a to-many hop reached after an M2O one', () => {
		expect(
			resolveScopedCacheM2oJoinChainFromPath(schema, 'owned_sub_item', [
				'owned_item',
				'owned_sub_items',
			]),
		).toBe(null);
	});

	it('stops at a field no relation describes', () => {
		expect(
			resolveScopedCacheM2oJoinChainFromPath(schema, 'owned_item', ['label']),
		).toBe(null);
	});

	it('resolves an empty chain to no hops', () => {
		expect(
			resolveScopedCacheM2oJoinChainFromPath(schema, 'owned_item', []),
		).toEqual([]);
	});
});

describe('scopedCacheCollectionsBeyondNestedRows', () => {
	const schema = new SchemaBuilder()
		.collection('company', (c) => {
			c.field('id').id();
			c.field('name').string();
		})
		.collection('owner', (c) => {
			c.field('id').id();
			c.field('name').string();
			c.field('company').m2o('company');
		})
		.collection('owned_item', (c) => {
			c.field('id').id();
			c.field('owner').m2o('owner');
		})
		.build();

	const companyNode = {
		type: 'm2o',
		name: 'company',
		fieldKey: 'company',
		children: [],
		query: {},
		cases: [],
		whenCase: [],
		relation: { related_collection: 'company' },
	} as unknown as M2ONode;

	// Only the parts the function reads. The real shape comes from
	// `getAstFromQuery`, which the blackbox suite exercises end to end; pulling it
	// in here would drag the Redis KV into a unit test.
	function astOf(query: Query, ownerNode: Partial<M2ONode> = {}): AST {
		return {
			type: 'root',
			name: 'owned_item',
			query,
			cases: [],
			children: [
				{
					type: 'm2o',
					name: 'owner',
					fieldKey: 'owner',
					children: [],
					query: {},
					cases: [],
					whenCase: [],
					relation: { related_collection: 'owner' },
					...ownerNode,
				} as M2ONode,
			],
		} as AST;
	}

	it('names a collection the root query filters on', () => {
		// Renaming a row this read never nested moves its item INTO the filtered
		// set, so the response depends on rows beyond the ones it carried.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({ filter: { owner: { name: { _eq: 'alice' } } } }),
			),
		]).toContain('owner');
	});

	it('spares a collection the root filter names by key', () => {
		// The rows it reaches are exactly that key, which
		// `pinnedScopedCacheTagsFromKeyedFilters` pins; nothing forces bare.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({ filter: { owner: { id: { _eq: 7 } } } }),
			),
		]).not.toContain('owner');
	});

	it('names a collection keyed by the filter but also sorted on', () => {
		// The sort reaches rows the key never named, so the key does not cover
		// what this read depends on.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({
					filter: { owner: { id: { _eq: 7 } } },
					sort: ['owner.name'],
				}),
			),
		]).toContain('owner');
	});

	it('names a collection the root query sorts on', () => {
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({ sort: ['owner.name'] }),
			),
		]).toContain('owner');
	});

	it('names a collection whose nested node carries its own filter', () => {
		// A parent the deep filter withholds arrives as a null slot, which is what
		// `mergeWithParentItems` also writes for a null foreign key.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({}, { query: { filter: { name: { _eq: 'alice' } } } }),
			),
		]).toContain('owner');
	});

	it('names a collection whose nested node carries permission cases', () => {
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({}, { cases: [{ name: { _eq: 'alice' } }] }),
			),
		]).toContain('owner');
	});

	it('names a collection whose nested node carries a field-level case', () => {
		// A `whenCase` withholds the field for the rows the case excludes, and
		// `mergeWithParentItems` writes those slots null like any hidden parent.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({}, { whenCase: [0] }),
			),
		]).toContain('owner');
	});

	it('names a collection a nested node\'s own filter reads', () => {
		// The filter withholds `owner`, but WHICH owners it withholds is decided
		// by company rows — including ones the response never nested.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({}, {
					children: [companyNode],
					query: { filter: { company: { name: { _eq: 'acme' } } } },
				}),
			),
		]).toContain('company');
	});

	it('names a collection withheld two hops down', () => {
		// The walk has to recurse: the node carrying the filter is the grandchild,
		// not the child the root nested.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({}, {
					children: [{
						...companyNode,
						query: { filter: { name: { _eq: 'acme' } } },
					}],
				}),
			),
		]).toContain('company');
	});

	it('leaves a collection the read only projects', () => {
		// Non-vacuity: the cases above name `owner` because of the query, not
		// because every nested collection lands in the set.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(schema, astOf({})),
		]).not.toContain('owner');
	});

	it('leaves a grandchild the read only projects', () => {
		// Non-vacuity for the two cases above: nesting `company` is not itself
		// what puts it in the set.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({}, { children: [companyNode] }),
			),
		]).not.toContain('company');
	});

	it('keeps a filtered collection when a group reads it too', () => {
		// Grouping reads rows no key named, exactly as a sort does, so a filter
		// that named keys no longer exempts the collection.
		expect([...scopedCacheCollectionsBeyondNestedRows(
			schema,
			astOf({
				filter: { owner: { id: { _eq: 1 } } },
				group: ['owner.name'],
			}),
		)]).toContain('owner');
	});

	it('keeps a filtered collection when an aggregate reads it too', () => {
		expect([...scopedCacheCollectionsBeyondNestedRows(
			schema,
			astOf({
				filter: { owner: { id: { _eq: 1 } } },
				aggregate: { count: ['owner.name'] },
			}),
		)]).toContain('owner');
	});
});

describe('scopedCacheFilterKeyingByCollection', () => {
	const schema = new SchemaBuilder()
		.collection('company', (c) => {
			c.field('id').id();
			c.field('name').string();
		})
		.collection('owner', (c) => {
			c.field('id').id();
			c.field('name').string();
			c.field('company').m2o('company');
		})
		.collection('owned_item', (c) => {
			c.field('id').id();
			c.field('label').string();
			c.field('owner').m2o('owner');
			c.field('owned_sub_items').o2m('owned_sub_item', 'owned_item');
			c.field('categories').m2m('category');
		})
		.collection('owned_sub_item', (c) => {
			c.field('id').id();
			c.field('owned_item').m2o('owned_item');
		})
		.collection('category', (c) => {
			c.field('id').id();
			c.field('name').string();
		})
		.build();

	function keyingOf(query: Query, cases: Filter[] = []) {
		return scopedCacheFilterKeyingByCollection(schema, {
			type: 'root',
			name: 'owned_item',
			query,
			cases,
			children: [],
		} as AST);
	}

	// The SQL each of these compiles to is pinned by
	// `apply-query/filter/related-key-join.test.ts`, which is what makes the
	// key the whole dependency rather than a guess about the planner.
	it('needs no tag for an M2O terminating on the related primary key', () => {
		// `owned_item.owner = 7` is answered by the row's own column, and behind
		// an enforced constraint the owner cannot vanish without writing it.
		expect(keyingOf({ filter: { owner: { id: { _eq: 7 } } } }).get('owner'))
			.toEqual({ kind: 'independent', field: 'id', keys: new Set([7]) });
	});

	it('needs no tag for an M2O whichever operator its key carries', () => {
		expect(keyingOf({ filter: { owner: { id: { _in: [7, 8] } } } }).get('owner'))
			.toEqual({ kind: 'independent', field: 'id', keys: new Set([7, 8]) });

		expect(keyingOf({ filter: { owner: { id: { _gt: 7 } } } }).get('owner'))
			.toEqual({ kind: 'independent', field: 'id', keys: new Set() });
	});

	it('keys the M2O again when a sibling reads another of its columns', () => {
		// `id` is answered by this row's own column, but `name` is not: that one
		// reads the owner row, so the read depends on it after all. One alias is
		// one joined row, so the key still pins which.
		expect(keyingOf({
			filter: { owner: { id: { _eq: 7 }, name: { _eq: 'alice' } } },
		}).get('owner')).toEqual({ kind: 'keyed', field: 'id', keys: new Set([7]) });
	});

	it('keys the M2O again when the condition reaches past its key', () => {
		expect(keyingOf({
			filter: { owner: { company: { id: { _eq: 3 } } } },
		}).get('owner')).toEqual({ kind: 'unkeyed' });
	});

	it('keys the M2O again once the relation carries no constraint', () => {
		// Without one the owner can be deleted behind this row's back, leaving a
		// foreign key that no longer joins and a result that changed with
		// nothing written on this side.
		const unconstrained = new SchemaBuilder()
			.collection('owner', (c) => {
				c.field('id').id();
				c.field('name').string();
			})
			.collection('owned_item', (c) => {
				c.field('id').id();
				c.field('owner').m2o('owner');
			})
			.build();

		for (const relation of unconstrained.relations) {
			relation.schema = null;
		}

		expect(scopedCacheFilterKeyingByCollection(unconstrained, {
			type: 'root',
			name: 'owned_item',
			query: { filter: { owner: { id: { _eq: 7 } } } },
			cases: [],
			children: [],
		} as AST).get('owner')).toEqual({
			kind: 'keyed',
			field: 'id',
			keys: new Set([7]),
		});
	});

	it('keys a to-many hop, whose far row the key names just as narrowly', () => {
		expect(keyingOf({ filter: { owned_sub_items: { id: { _eq: 7 } } } })
			.get('owned_sub_item'))
			.toEqual({ kind: 'keyed', field: 'id', keys: new Set([7]) });
	});

	// The four spellings below compile to ONE query — `getOperation` reads a bare
	// leaf as `_eq`, and `getColumnPath` appends the related primary key to a
	// to-many alias — so they have to reach one keying. Their SQL equality is
	// asserted in `apply-query/filter/related-key-join.test.ts`.
	it('keys a to-many written with a bare key value', () => {
		expect(keyingOf({ filter: { owned_sub_items: { id: 7 } } as unknown as Filter })
			.get('owned_sub_item'))
			.toEqual({ kind: 'keyed', field: 'id', keys: new Set([7]) });
	});

	it('keys a to-many written as an operator on the alias', () => {
		expect(keyingOf({ filter: { owned_sub_items: { _eq: 7 } } })
			.get('owned_sub_item'))
			.toEqual({ kind: 'keyed', field: 'id', keys: new Set([7]) });
	});

	it('keys a to-many written as a bare value on the alias', () => {
		// Cast through `unknown`: `Filter` models a leaf as an operator object,
		// while `getOperation` accepts the bare value these two pass.
		expect(keyingOf({ filter: { owned_sub_items: 7 } as unknown as Filter })
			.get('owned_sub_item'))
			.toEqual({ kind: 'keyed', field: 'id', keys: new Set([7]) });
	});

	it('keys the junction an M2M shorthand names, as `getColumnPath` does', () => {
		expect(keyingOf({ filter: { categories: { _eq: 7 } } })
			.get('owned_item_category_junction'))
			.toEqual({ kind: 'keyed', field: 'id', keys: new Set([7]) });
	});

	it('keys a related collection by the scoped field a filter names', () => {
		// `name` is no key, but as a scoped field the filter bounds owner to that
		// value, and the write side emits `owner:name=<value>` — so it pins by name.
		const scopedSchema = new SchemaBuilder()
			.collection('owner', (c) => {
				c.field('id').id();
				c.field('name').string();
			})
			.collection('owned_item', (c) => {
				c.field('id').id();
				c.field('owner').m2o('owner');
			})
			.build();

		scopedSchema.collections['owner']!.scopedCacheFields = ['name'];

		expect(scopedCacheFilterKeyingByCollection(scopedSchema, {
			type: 'root',
			name: 'owned_item',
			query: { filter: { owner: { name: { _eq: 'alice' } } } },
			cases: [],
			children: [],
		} as AST).get('owner')).toEqual({
			kind: 'keyed',
			field: 'name',
			keys: new Set(['alice']),
		});
	});

	it('leaves a related collection unkeyed on a non-scoped, non-key field', () => {
		// The same filter where `name` is neither the pk nor a scoped field names no
		// pinnable slice, so the owner stays unkeyed (bare).
		expect(keyingOf({ filter: { owner: { name: { _eq: 'alice' } } } })
			.get('owner')).toEqual({ kind: 'unkeyed' });
	});

	it('reports nothing for an M2O shorthand, which joins no related row', () => {
		// The mirror of the above: across an M2O the foreign key is a column of
		// THIS collection, so the related one is never read.
		expect(keyingOf({ filter: { owner: 3 } as unknown as Filter }).get('owner'))
			.toBe(undefined);

		expect(keyingOf({ filter: { owner: { _eq: 3 } } }).get('owner'))
			.toBe(undefined);
	});

	it('leaves a to-many shorthand unkeyed on an operator that names no row', () => {
		expect(keyingOf({ filter: { owned_sub_items: { _gt: 7 } } })
			.get('owned_sub_item'))
			.toEqual({ kind: 'unkeyed' });
	});

	it(oneLine`
		leaves a to-many a function key counts unkeyed, whatever total it names
	`, () => {
		// `count(owned_sub_items) = 7` reads EVERY sub-item of every candidate
		// row to reach its total. The number it compares against is a
		// cardinality, not a row key, so reading it as one would pin the read to
		// a row the filter never named and leave an insert unable to drop it.
		expect(keyingOf({
			filter: { 'count(owned_sub_items)': { _eq: 7 } } as Filter,
		}).get('owned_sub_item')).toEqual({ kind: 'unkeyed' });
	});

	// Non-vacuity for the case above: unkeyed is the answer because the
	// collection IS reached, not because the walk lost sight of it.
	it.each(['_eq', '_gt'])(oneLine`
		still reports the to-many a %s function key counts, keeping a bare tag
	`, (operator) => {
		expect([...keyingOf({
			filter: { 'count(owned_sub_items)': { [operator]: 7 } } as Filter,
		}).keys()]).toContain('owned_sub_item');
	});

	it('reports nothing for an A2O scope naming no collection of the schema', () => {
		// The scope is request text picking the table to join. One that names
		// nothing joins nothing, and must not reach the response's tag header.
		expect([...keyingOf({
			filter: { categories: { 'category_id:nonexistent': { id: { _eq: 7 } } } },
		}).keys()].sort()).toEqual(['owned_item', 'owned_item_category_junction']);
	});

	it('leaves a key unkeyed when its type cannot be pinned', () => {
		// A date-like key is not safe to slice on, so even the primary key under
		// `_eq` reports unkeyed and the collection keeps its bare tag.
		const dated = new SchemaBuilder()
			.collection('owned_item', (c) => {
				c.field('id').id();
				c.field('owned_sub_items').o2m('owned_sub_item', 'owned_item');
			})
			.collection('owned_sub_item', (c) => {
				c.field('id').id();
				c.field('owned_item').m2o('owned_item');
			})
			.build();

		dated.collections['owned_sub_item']!.fields['id']!.type = 'dateTime';

		expect(scopedCacheFilterKeyingByCollection(dated, {
			type: 'root',
			name: 'owned_item',
			query: { filter: { owned_sub_items: { id: { _eq: 7 } } } },
			cases: [],
			children: [],
		} as unknown as AST).get('owned_sub_item')).toEqual({ kind: 'unkeyed' });
	});

	it('keys the M2O again when its key carries more than operators', () => {
		// A further field under the related key reaches past it, so the near row's
		// own column no longer answers the condition and the far row is read after
		// all. The key still says which row that is, so it is keyed, not bare.
		expect(keyingOf({
			filter: {
				owner: { id: { _eq: 7, deeper: { name: { _eq: 'x' } } } },
			} as unknown as Filter,
		}).get('owner')).toEqual({
			kind: 'keyed',
			field: 'id',
			keys: new Set([7]),
		});
	});

	it('reads nothing from an operator carrying no node', () => {
		// `_and` with a scalar is not a shape the walk can read, and anything it
		// cannot read is treated as reading every row under it.
		expect(keyingOf({
			filter: { owner: { _and: 5 } } as unknown as Filter,
		}).get('owner')).toEqual({ kind: 'unkeyed' });
	});

	it('keys through `_some`, which pushes the key into a subquery', () => {
		expect(keyingOf({
			filter: { owned_sub_items: { _some: { id: { _eq: 7 } } } },
		}).get('owned_sub_item'))
			.toEqual({ kind: 'keyed', field: 'id', keys: new Set([7]) });
	});

	it('keys through `_none`, which negates on that one row alone', () => {
		expect(keyingOf({
			filter: { owned_sub_items: { _none: { id: { _eq: 7 } } } },
		}).get('owned_sub_item'))
			.toEqual({ kind: 'keyed', field: 'id', keys: new Set([7]) });
	});

	it('keys the far side of an M2M and leaves its junction unkeyed', () => {
		const keying = keyingOf({
			filter: { categories: { category_id: { id: { _eq: 7 } } } },
		});

		// The junction's own `category_id` answers the far key, so only the
		// junction is depended on — and it is depended on wholesale.
		expect(keying.get('category'))
			.toEqual({ kind: 'independent', field: 'id', keys: new Set([7]) });

		expect(keying.get('owned_item_category_junction'))
			.toEqual({ kind: 'unkeyed' });
	});

	it('leaves a non-key column unkeyed, since a write can move a row into it', () => {
		expect(keyingOf({ filter: { owner: { name: { _eq: 'alice' } } } }).get('owner'))
			.toEqual({ kind: 'unkeyed' });
	});

	it('leaves an operator other than `_eq`/`_in` unkeyed across a to-many', () => {
		expect(keyingOf({ filter: { owned_sub_items: { id: { _neq: 7 } } } })
			.get('owned_sub_item'))
			.toEqual({ kind: 'unkeyed' });
	});

	it('leaves an empty `_in` unkeyed rather than pinned to nothing', () => {
		expect(keyingOf({ filter: { owned_sub_items: { id: { _in: [] } } } })
			.get('owned_sub_item'))
			.toEqual({ kind: 'unkeyed' });
	});

	it('leaves a collection hopped THROUGH unkeyed, keying only the far end', () => {
		const keying = keyingOf({
			filter: { owner: { company: { id: { _eq: 3 } } } },
		});

		// Reaching the company reads the `company` column of every owner that
		// could be joined, so no owner row is named.
		expect(keying.get('owner')).toEqual({ kind: 'unkeyed' });

		expect(keying.get('company'))
			.toEqual({ kind: 'independent', field: 'id', keys: new Set([3]) });
	});

	it('keys the collection hopped THROUGH when its fk is a scoped field', () => {
		// The crossing is answered by the near row's own `company` fk column; as a
		// scoped field the filter bounds the owner to that value and the write emits
		// `owner:company=3`, so it pins the near collection instead of leaving it bare.
		const scopedSchema = new SchemaBuilder()
			.collection('company', (c) => {
				c.field('id').id();
			})
			.collection('owner', (c) => {
				c.field('id').id();
				c.field('company').m2o('company');
			})
			.collection('owned_item', (c) => {
				c.field('id').id();
				c.field('owner').m2o('owner');
			})
			.build();

		scopedSchema.collections['owner']!.scopedCacheFields = ['company'];

		const keying = scopedCacheFilterKeyingByCollection(scopedSchema, {
			type: 'root',
			name: 'owned_item',
			query: { filter: { owner: { company: { id: { _eq: 3 } } } } },
			cases: [],
			children: [],
		} as AST);

		expect(keying.get('owner'))
			.toEqual({ kind: 'keyed', field: 'company', keys: new Set([3]) });

		expect(keying.get('company'))
			.toEqual({ kind: 'independent', field: 'id', keys: new Set([3]) });
	});

	it(oneLine`
		reports nothing for a foreign key compared in place, which joins nothing
	`, () => {
		expect(keyingOf({ filter: { owner: { _eq: 7 } } }).get('owner'))
			.toBe(undefined);
	});

	it('keeps the key when a sibling condition reads the same joined row', () => {
		// One join alias, so only owner 7 can satisfy both.
		expect(keyingOf({
			filter: {
				_and: [
					{ owner: { id: { _eq: 7 } } },
					{ owner: { name: { _eq: 'alice' } } },
				],
			},
		}).get('owner')).toEqual({ kind: 'keyed', field: 'id', keys: new Set([7]) });
	});

	it('drops the key when a SECOND path reaches the collection unkeyed', () => {
		// Two aliases, two independent joined rows: renaming any owner moves an
		// item into the second path's result.
		expect(keyingOf({
			filter: {
				_and: [
					{ owner: { id: { _eq: 7 } } },
					{
						owned_sub_items: {
							owned_item: { owner: { name: { _eq: 'alice' } } },
						},
					},
				],
			},
		}).get('owner')).toEqual({ kind: 'unkeyed' });
	});

	it('unions the keys an `_or` names across its branches', () => {
		expect(keyingOf({
			filter: {
				_or: [
					{ owner: { id: { _eq: 7 } } },
					{ owner: { id: { _in: [8, 9] } } },
				],
			},
		}).get('owner'))
			.toEqual({ kind: 'independent', field: 'id', keys: new Set([7, 8, 9]) });
	});

	it('drops the key when any `_or` branch reaches the collection unkeyed', () => {
		expect(keyingOf({
			filter: {
				_or: [
					{ owner: { id: { _eq: 7 } } },
					{ owner: { name: { _eq: 'alice' } } },
				],
			},
		}).get('owner')).toEqual({ kind: 'unkeyed' });
	});

	it('keeps the key when an `_or` branch never mentions the collection', () => {
		// A row coming back through the second branch reads no owner at all.
		expect(keyingOf({
			filter: {
				_or: [
					{ owner: { id: { _eq: 7 } } },
					{ label: { _eq: 'loose' } },
				],
			},
		}).get('owner')).toEqual({
			kind: 'independent',
			field: 'id',
			keys: new Set([7]),
		});
	});

	it('leaves everything under a `_not` unkeyed, which applyFilter drops', () => {
		expect(keyingOf({
			filter: { _not: { owner: { id: { _eq: 7 } } } } as Filter,
		}).get('owner')).toEqual({ kind: 'unkeyed' });
	});

	it('folds the permission cases in the way the SQL WHERE folds them', () => {
		expect(keyingOf({}, [{ owner: { id: { _eq: 7 } } }]).get('owner'))
			.toEqual({ kind: 'independent', field: 'id', keys: new Set([7]) });
	});

	it('leaves the AST filter as written, so permissions see what they saw', () => {
		// The expansion feeds this analysis only. `extractFieldsFromQuery` drives
		// `validatePathPermissions`, so rewriting the AST filter would start
		// naming collections a shorthand does not name today and change which
		// permissions a query requires.
		const filter = { owned_sub_items: { _eq: 7 } };
		const query = { filter };

		scopedCacheFilterKeyingByCollection(schema, {
			type: 'root',
			name: 'owned_item',
			query,
			cases: [],
			children: [],
		} as unknown as AST);

		expect(filter).toEqual({ owned_sub_items: { _eq: 7 } });
		expect(query.filter).toBe(filter);
	});

	it('reads a nested node filter against the node collection, not the root', () => {
		expect(scopedCacheFilterKeyingByCollection(schema, {
			type: 'root',
			name: 'owned_item',
			query: {},
			cases: [],
			children: [
				{
					type: 'm2o',
					name: 'owner',
					fieldKey: 'owner',
					children: [],
					query: { filter: { company: { id: { _eq: 3 } } } },
					cases: [],
					whenCase: [],
					relation: { related_collection: 'owner' },
				} as unknown as M2ONode,
			],
		} as AST).get('company'))
			.toEqual({ kind: 'independent', field: 'id', keys: new Set([3]) });
	});
});

describe('scopedCacheOwnershipNestedPkPaths', () => {
	it('stops where the ownership chain loops back on itself', () => {
		// `member` owns through `team` and `team` back through `member`. The walk
		// has to stop at the repeat rather than following the loop forever, and
		// the two-hop path it did find is what makes nesting worth it at all: a
		// one-hop chain is already pinned from the read row's own columns.
		const cyclic = new SchemaBuilder()
			.collection('member', (c) => {
				c.field('id').id();
				c.field('team').m2o('team');
			})
			.collection('team', (c) => {
				c.field('id').id();
				c.field('lead').m2o('member');
			})
			.build();

		cyclic.collections['member']!.scopedCacheFields = ['team'];
		cyclic.collections['team']!.scopedCacheFields = ['lead'];

		expect(scopedCacheOwnershipNestedPkPaths(cyclic, 'member'))
			.toEqual(['team.id', 'team.lead.id']);
	});

	it('nests nothing when every ancestor is one hop out', () => {
		// The control for the case above: a single hop is answered by the read
		// row's own foreign key, so there is nothing to nest for.
		const flat = new SchemaBuilder()
			.collection('member', (c) => {
				c.field('id').id();
				c.field('team').m2o('team');
			})
			.collection('team', (c) => {
				c.field('id').id();
				c.field('name').string();
			})
			.build();

		flat.collections['member']!.scopedCacheFields = ['team'];
		flat.collections['team']!.scopedCacheFields = ['name'];

		expect(scopedCacheOwnershipNestedPkPaths(flat, 'member')).toEqual([]);
	});
});

describe('pinnedScopedCacheTagsFromO2mChildren', () => {
	// `child` hangs off `parent` twice, over two different fks, so one read can
	// reach it by two names. `grandchild` sits a second to-many hop down, and
	// `root` reaches the parent through an M2O so a prefix has something to walk.
	const schema = new SchemaBuilder()
		.collection('parent', (c) => {
			c.field('id').id();
			c.field('name').string();
			c.field('children').o2m('child', 'parent');
			c.field('alt_children').o2m('child', 'alt_parent');
		})
		.collection('child', (c) => {
			c.field('id').id();
			c.field('body').string();
			c.field('parent').m2o('parent');
			c.field('alt_parent').m2o('parent');
			c.field('grandchildren').o2m('grandchild', 'child');
		})
		.collection('grandchild', (c) => {
			c.field('id').id();
			c.field('child').m2o('child');
		})
		.collection('root', (c) => {
			c.field('id').id();
			c.field('main').m2o('parent');
		})
		.build();

	// The pin only applies where the write side emits the matching shallow tag,
	// which is what declaring the fk as a flat scope field promises.
	schema.collections['child']!.scopedCacheFields = ['parent', 'alt_parent'];
	schema.collections['grandchild']!.scopedCacheFields = ['child'];

	function fieldMapOf(
		...paths: [QueryPath[number], CollectionKey][]
	): FieldMap {
		return {
			read: new Map(paths.map(([path, collection]) => {
				return [path, { collection, fields: new Set<string>() }];
			})),
			other: new Map(),
		};
	}

	function pinnedFor(
		rootCollection: CollectionKey,
		fieldMap: FieldMap,
		records: Item[],
		beyond = new Set<CollectionKey>(),
	) {
		return pinnedScopedCacheTagsFromO2mChildren(
			schema,
			rootCollection,
			fieldMap,
			records,
			beyond,
		);
	}

	it('pins the child by the key of every parent row the read surfaced', () => {
		expect(pinnedFor(
			'parent',
			fieldMapOf(['children', 'child']),
			[{ id: 1, name: 'a' }, { id: 2, name: 'b' }],
		).get('child')).toEqual([
			{ collection: 'child', field: 'parent', value: 1, type: 'integer' },
			{ collection: 'child', field: 'parent', value: 2, type: 'integer' },
		]);
	});

	it('walks an M2O prefix to the parent the to-many hangs off', () => {
		expect(pinnedFor(
			'root',
			fieldMapOf(['main.children', 'child']),
			[{ id: 9, main: { id: 1, name: 'a' } }],
		).get('child')).toEqual([
			{ collection: 'child', field: 'parent', value: 1, type: 'integer' },
		]);
	});

	it('walks a to-many prefix into every row it carried', () => {
		// A deep pivot: the prefix is itself an O2M, so each child row surfaced
		// under it is a parent of the grandchildren.
		expect(pinnedFor(
			'parent',
			fieldMapOf(['children.grandchildren', 'grandchild']),
			[{ id: 1, children: [{ id: 10 }, { id: 11 }] }],
		).get('grandchild')).toEqual([
			{ collection: 'grandchild', field: 'child', value: 10, type: 'integer' },
			{ collection: 'grandchild', field: 'child', value: 11, type: 'integer' },
		]);
	});

	it('declines a prefix that names no relation', () => {
		expect(pinnedFor(
			'parent',
			fieldMapOf(['name.children', 'child']),
			[{ id: 1, name: 'a' }],
		).has('child')).toBe(false);
	});

	it('declines a prefix the response answered with a scalar', () => {
		// `main` came back as the foreign key rather than the nested row, so the
		// walk cannot reach the parent it would key on.
		expect(pinnedFor(
			'root',
			fieldMapOf(['main.children', 'child']),
			[{ id: 9, main: 1 }],
		).has('child')).toBe(false);
	});

	it('declines when the prefix surfaced no row at all', () => {
		// A null foreign key is skipped rather than treated as a parent, and with
		// none left the collection is pinned by nothing.
		expect(pinnedFor(
			'root',
			fieldMapOf(['main.children', 'child']),
			[{ id: 9, main: null }],
		).has('child')).toBe(false);
	});

	it('declines a child two paths key on different foreign keys', () => {
		// `children` keys on `parent`, `alt_children` on `alt_parent`. Mixing them
		// under one field would pin the wrong slice.
		expect(pinnedFor(
			'parent',
			fieldMapOf(['children', 'child'], ['alt_children', 'child']),
			[{ id: 1, name: 'a' }],
		).has('child')).toBe(false);
	});

	it('declines when a surfaced parent row carries no key', () => {
		// One keyless row leaves part of the set unpinned, which takes the whole
		// collection to the bare tag rather than a partial pin.
		expect(pinnedFor(
			'parent',
			fieldMapOf(['children', 'child']),
			[{ id: 1, name: 'a' }, { name: 'no key' }],
		).has('child')).toBe(false);
	});

	it('leaves the root collection alone', () => {
		expect(pinnedFor(
			'parent',
			fieldMapOf(['', 'parent']),
			[{ id: 1, name: 'a' }],
		).has('parent')).toBe(false);
	});

	it('declines a collection the read depends on beyond its nested rows', () => {
		expect(pinnedFor(
			'parent',
			fieldMapOf(['children', 'child']),
			[{ id: 1, name: 'a' }],
			new Set(['child']),
		).has('child')).toBe(false);
	});

	it('drops the pin whole past the ceiling, never trimmed', () => {
		expect(pinnedFor(
			'parent',
			fieldMapOf(['children', 'child']),
			Array.from(
				{ length: scopedCacheMaxPinsPerCollection() + 1 },
				(_, at) => ({ id: at + 1, name: `p${at}` }),
			),
		).has('child')).toBe(false);
	});
});

describe('pinnedScopedCacheTagsFromKeyedFilters', () => {
	const schema = new SchemaBuilder()
		.collection('owner', (c) => {
			c.field('id').id();
			c.field('name').string();
		})
		.collection('owned_item', (c) => {
			c.field('id').id();
			c.field('owner').m2o('owner');
		})
		.build();

	function pinsFor(
		keying: Map<CollectionKey, ScopedCacheFilterKeying>,
	) {
		return pinnedScopedCacheTagsFromKeyedFilters(schema, 'owned_item', keying);
	}

	it('pins one primary-key tag per key the filter named', () => {
		expect(pinsFor(
			new Map([['owner', { kind: 'keyed', field: 'id', keys: new Set([7, 8]) }]]),
		).get('owner')).toEqual([
			{ collection: 'owner', field: 'id', value: 7, type: 'integer' },
			{ collection: 'owner', field: 'id', value: 8, type: 'integer' },
		]);
	});

	it('pins nothing for a collection the filter left unkeyed', () => {
		expect(pinsFor(new Map([['owner', { kind: 'unkeyed' }]])).has('owner'))
			.toBe(false);
	});

	it('leaves the root out, since its own filter already bounds it', () => {
		const pins = pinsFor(new Map([
			['owned_item', { kind: 'keyed', field: 'id', keys: new Set([1]) }],
			['owner', { kind: 'keyed', field: 'id', keys: new Set([7]) }],
		]));

		expect(pins.has('owned_item')).toBe(false);
		expect(pins.has('owner')).toBe(true);
	});

	it('collapses keys the write side cannot tell apart', () => {
		// `7` and `'7'` canonicalize to one token, which is the one slice a
		// write to that row emits.
		expect(pinsFor(
			new Map([['owner', { kind: 'keyed', field: 'id', keys: new Set([7, '7']) }]]),
		).get('owner')).toEqual([
			{ collection: 'owner', field: 'id', value: 7, type: 'integer' },
		]);
	});

	it('drops the pin whole past the ceiling, never trimmed', () => {
		// A trimmed key set would leave the rows it omits covered by nothing.
		expect(pinsFor(new Map([['owner', {
			kind: 'keyed',
			keys: new Set(Array.from(
				{ length: scopedCacheMaxPinsPerCollection() + 1 },
				(_, index) => index,
			)),
		}]])).has('owner')).toBe(false);
	});

	it('pins a collection no relation of the schema describes as nothing', () => {
		expect(pinsFor(
			new Map([['absent_collection', {
				kind: 'keyed',
				field: 'id',
				keys: new Set([1]),
			}]]),
		).has('absent_collection')).toBe(false);
	});
});

describe('scopedCacheNestedCollections', () => {
	function astNesting(children: AST['children']): AST {
		return {
			type: 'root',
			name: 'owned_item',
			query: {},
			cases: [],
			children,
		} as AST;
	}

	it('names an M2O node the read nests', () => {
		expect([...scopedCacheNestedCollections(astNesting([
			{
				type: 'm2o',
				name: 'owner',
				fieldKey: 'owner',
				children: [],
				query: {},
				cases: [],
				whenCase: [],
				relation: { related_collection: 'owner' },
			} as unknown as M2ONode,
		]))]).toEqual(['owner']);
	});

	it('names a to-many node, which no parent-key pin can cover', () => {
		expect([...scopedCacheNestedCollections(astNesting([
			{
				type: 'o2m',
				name: 'owned_sub_item',
				fieldKey: 'owned_sub_items',
				children: [],
				query: {},
				cases: [],
				whenCase: [],
				relation: { collection: 'owned_sub_item' },
			} as unknown as O2MNode,
		]))]).toEqual(['owned_sub_item']);
	});

	it('names every collection an A2O node can resolve to', () => {
		expect([...scopedCacheNestedCollections(astNesting([
			{
				type: 'a2o',
				names: ['owner', 'company'],
				fieldKey: 'subject',
				children: { owner: [], company: [] },
				query: { owner: {}, company: {} },
				cases: { owner: [], company: [] },
				whenCase: [],
				relation: {},
			} as unknown as A2MNode,
		]))]).toEqual(['owner', 'company']);
	});

	it('names a collection nested under another nested node', () => {
		expect([...scopedCacheNestedCollections(astNesting([
			{
				type: 'm2o',
				name: 'owner',
				fieldKey: 'owner',
				query: {},
				cases: [],
				whenCase: [],
				relation: { related_collection: 'owner' },
				children: [
					{
						type: 'm2o',
						name: 'company',
						fieldKey: 'company',
						children: [],
						query: {},
						cases: [],
						whenCase: [],
						relation: { related_collection: 'company' },
					} as unknown as M2ONode,
				],
			} as unknown as M2ONode,
		]))]).toEqual(['owner', 'company']);
	});

	it('names nothing for a read that nests no collection', () => {
		expect([...scopedCacheNestedCollections(astNesting([
			{ type: 'field', name: 'label', fieldKey: 'label' },
		] as unknown as AST['children']))]).toEqual([]);
	});
});
