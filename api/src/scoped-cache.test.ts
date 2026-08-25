import { SchemaBuilder } from '@directus/schema-builder';
import type { FieldMap } from './permissions/modules/process-ast/types.js';
import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	countScopedCacheTagMembers,
	scopedCacheTagLabel,
	serializeScopedCacheTags,
	createScopedCacheCollector,
	pinnedScopedCacheTagsFromEmbeddedRecords,
	resolveScopedCacheM2oHops,
	SCOPED_CACHE_EMBEDDED_PIN_CEILING,
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

describe('pinnedScopedCacheTagsFromEmbeddedRecords', () => {
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

	function fieldMapOf(...paths: [string, string][]): FieldMap {
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
		pins each embedded collection by the keys the response carried, deduped
	`, () => {
		// Two sub-items under distinct items but ONE owner: the owner tag must not
		// come out twice, and the item tags must not collapse to one.
		const pinned = pinnedScopedCacheTagsFromEmbeddedRecords(
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
		const pinned = pinnedScopedCacheTagsFromEmbeddedRecords(
			schema,
			'owned_sub_item',
			subItemFieldMap,
			[{ id: 1, label: 'a', owned_item: { id: 10, owner: { id: 100 } } }],
		);

		expect(pinned.has('owned_sub_item')).toBe(false);
	});

	it('keeps a collection reached across a to-many hop bare', () => {
		// An INSERT into `owned_item` creates a row this read would have listed, and
		// no key tag covers a key that did not exist when the entry was filled.
		const pinned = pinnedScopedCacheTagsFromEmbeddedRecords(
			schema,
			'owner',
			fieldMapOf(['', 'owner'], ['owned_items', 'owned_item']),
			[{ id: 100, owned_items: [{ id: 10 }, { id: 11 }] }],
		);

		expect(pinned.has('owned_item')).toBe(false);
	});

	it(oneLine`
		keeps a collection bare when one of its paths crosses a to-many hop
	`, () => {
		// Reached twice: directly by M2O, and back down the owner's to-many. The
		// weakest path decides, or the read goes stale on an insert.
		const pinned = pinnedScopedCacheTagsFromEmbeddedRecords(
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
		);

		expect(pinned.has('owned_item')).toBe(false);
	});

	it('skips a row whose parent link is empty, pinning its siblings', () => {
		const pinned = pinnedScopedCacheTagsFromEmbeddedRecords(
			schema,
			'owned_sub_item',
			subItemFieldMap,
			[
				{ id: 1, label: 'a', owned_item: null },
				{ id: 2, label: 'b', owned_item: { id: 11, owner: { id: 100 } } },
			],
		);

		expect(pinned.get('owned_item')).toEqual([
			{ collection: 'owned_item', field: 'id', value: 11, type: 'integer' },
		]);

		expect(pinned.get('owner')).toEqual([
			{ collection: 'owner', field: 'id', value: 100, type: 'integer' },
		]);
	});

	it('keeps a collection bare when the read embedded no row of it', () => {
		// A relation the query only filtered or sorted on reaches the field map but
		// never the payload. Pinning nothing there would list the collection by
		// nothing at all, and no write to it would ever drop the read.
		expect(
			pinnedScopedCacheTagsFromEmbeddedRecords(
				schema,
				'owned_sub_item',
				fieldMapOf(['owned_item', 'owned_item']),
				[{ id: 1, owned_item: null }],
			).has('owned_item'),
		).toBe(false);
	});

	it('falls back to bare when an embedded row carries no key', () => {
		// Half a key set pins half the rows and silently serves the rest stale.
		const pinned = pinnedScopedCacheTagsFromEmbeddedRecords(
			schema,
			'owned_sub_item',
			fieldMapOf(['owned_item', 'owned_item']),
			[
				{ id: 1, owned_item: { id: 10 } },
				{ id: 2, owned_item: { name: 'y' } },
			],
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

		const pinned = pinnedScopedCacheTagsFromEmbeddedRecords(
			a2oSchema,
			'note',
			fieldMapOf(['subject:owner', 'owner']),
			[{ id: 1, 'subject:owner': { id: 100 } }],
		);

		expect(pinned.has('owner')).toBe(false);
	});

	describe('past the ceiling', () => {
		const records = Array.from(
			{ length: SCOPED_CACHE_EMBEDDED_PIN_CEILING + 1 },
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

			const pinned = pinnedScopedCacheTagsFromEmbeddedRecords(
				slicedSchema,
				'owned_item',
				ownerFieldMap,
				records,
			);

			expect(pinned.get('owner')).toEqual([
				{ collection: 'owner', field: 'space', value: 'shared', type: 'string' },
			]);
		});

		it('goes bare when the collection declares no slice to fall back on', () => {
			const pinned = pinnedScopedCacheTagsFromEmbeddedRecords(
				schema,
				'owned_item',
				ownerFieldMap,
				records,
			);

			expect(pinned.has('owner')).toBe(false);
		});

		it('still pins the same set one key below the ceiling', () => {
			// Non-vacuity: the two cases above degrade because of the COUNT, not
			// because this shape was never pinnable.
			const pinned = pinnedScopedCacheTagsFromEmbeddedRecords(
				schema,
				'owned_item',
				ownerFieldMap,
				records.slice(0, SCOPED_CACHE_EMBEDDED_PIN_CEILING),
			);

			expect(pinned.get('owner')).toHaveLength(
				SCOPED_CACHE_EMBEDDED_PIN_CEILING,
			);
		});
	});
});

describe('resolveScopedCacheM2oHops', () => {
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

	it('walks a chain of M2O hops to its related keys', () => {
		expect(
			resolveScopedCacheM2oHops(schema, 'owned_sub_item', [
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
			resolveScopedCacheM2oHops(schema, 'owned_item', ['owned_sub_items']),
		).toBe(null);
	});

	it('stops at a to-many hop reached after an M2O one', () => {
		expect(
			resolveScopedCacheM2oHops(schema, 'owned_sub_item', [
				'owned_item',
				'owned_sub_items',
			]),
		).toBe(null);
	});

	it('stops at a field no relation describes', () => {
		expect(
			resolveScopedCacheM2oHops(schema, 'owned_item', ['label']),
		).toBe(null);
	});

	it('resolves an empty chain to no hops', () => {
		expect(resolveScopedCacheM2oHops(schema, 'owned_item', [])).toEqual([]);
	});
});
