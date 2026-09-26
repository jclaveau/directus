import { SchemaBuilder } from '@directus/schema-builder';
import type {
	Filter,
	Item,
	Query,
	ScopedCacheDeclaredFingerprint,
} from '@directus/types';
import type {
	A2MNode,
	AST,
	FunctionFieldNode,
	M2ONode,
	O2MNode,
} from '../types/ast.js';
import type {
	CollectionKey,
	FieldMap,
	QueryPath,
} from '../permissions/modules/process-ast/types.js';
import { oneLine } from '@directus/utils';
import type { Keyv } from 'keyv';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	type ScopedCacheFilterKeying,
	ScopedCacheReadPlan,
	assertScopedCacheStoreSupported,
	bumpScopedCacheEpochs,
	canonicalizeScopedCachePinValue,
	countScopedCachePinMembers,
	createScopedCacheHookDeclarations,
	dropScopedCacheIndex,
	earlierScopedCacheEpoch,
	flushResponseCache,
	foldScopedCacheEpochsFromHookDeclarations,
	indexScopedCacheEntry,
	isPinnableScopeType,
	mergeScopedCacheEpochs,
	mergedScopedCacheEpochs,
	scopedCachePinsFromKeyedFilters,
	scopedCachePinsFromM2oParents,
	scopedCachePinsFromO2mChildren,
	purgeCollectionScopedCache,
	purgeScopedCache,
	readScopedCacheEpochs,
	resolveScopedCacheM2oJoinChainFromPath,
	retryPendingScopedCachePurges,
	scopedCacheCollectionsBeyondNestedRows,
	scopedCacheCollectionsChangedByOnDelete,
	scopedCacheCollectionsWithoutGuard,
	scopedCacheFilterKeyingByCollection,
	scopedCacheFingerprintOf,
	scopedCacheMaxPinsPerCollection,
	scopedCacheNestedCollections,
	scopedCacheOwnershipNestedPkPaths,
	scopedCachePathReversesChain,
	scopedCacheSweptDuringFill,
	scopedCachePinKeys,
	scopedCachePinKey,
	startScopedCachePurgeRecovery,
} from './index.js';
import { printableScopedCachePin } from '../utils/printable-scoped-cache-pins.js';
import { redisConfigAvailable, useRedis } from '../redis/index.js';
import emitter from '../emitter.js';
import { getCache } from '../cache.js';
import { useLogger } from '../logger/index.js';
import { withMeta } from '../utils/read-meta.js';
import {
	queueCacheAnomaly,
	queueCachePurge,
	readCacheDescriptorForRedisKey,
} from '../cache-events.js';
import {
	clearPendingScopedCachePurges,
	countFailedScopedCachePurgeRetry,
	listPendingScopedCachePurges,
	recordPendingScopedCachePurge,
} from '../scoped-cache-pending-purges.js';

// hoisted: scoped-cache.ts reads `const env = useEnv()` at module load, before a
// plain `const env` below would be initialised (temporal dead zone).
const env = vi.hoisted(() => {
	return {
		CACHE_AUTO_PURGE_MODE: 'scoped',
		CACHE_STORE: 'redis',
		CACHE_NAMESPACE: 'ns',
		// `useEnv` merges defaults.ts, so the real one always carries this.
		CACHE_SCOPED_MAX_PINS_PER_COLLECTION: 250,
		CACHE_SCOPED_MAX_QUERY_CASES: 16,
	} as Record<string, any>;
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('../redis/index.js');

vi.mock('../emitter.js', () => {
	return {
		default: {
			emitAction: vi.fn(),
			emitFilter: vi.fn((_event, payload) => payload),
		},
	};
});

vi.mock('../logger/index.js', () => ({ useLogger: vi.fn() }));
vi.mock('../cache.js', () => ({ getCache: vi.fn() }));

vi.mock('../cache-events.js', () => {
	return {
		queueCacheAnomaly: vi.fn(),
		queueCachePurge: vi.fn(),
		readCacheDescriptorForRedisKey: vi.fn(),
	};
});

vi.mock('../scoped-cache-pending-purges.js', () => {
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

// A purge drops its pin keys through a pipeline of chunked UNLINKs, so every redis
// stub a purge reaches has to answer `pipeline()` as well as the set commands.
// Replies the way ioredis does — one `[error, reply]` per queued command, the reply
// being what UNLINK removed — because the drop now counts what Redis reported
// rather than what it was handed.
function unlinkPipeline() {
	const unlink = vi.fn();
	let executed = 0;

	const exec = vi.fn(async () => {
		// Only what was queued since the last exec: a real `pipeline()` hands back a
		// fresh queue every call, and replaying the whole history would report keys
		// this exec never sent.
		const queued = unlink.mock.calls.slice(executed);
		executed = unlink.mock.calls.length;

		return queued.map(([keys]) => [null, keys.length]);
	});

	return {
		incr: vi.fn().mockReturnThis(),
		expire: vi.fn().mockReturnThis(),
		unlink,
		exec,
	};
}

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

// The one spelling of a pin that the fingerprint index, the purge attribution and
// the dev headers all share — if these drift, a purge stops matching the entries it
// actually dropped and the attribution silently reads zero.
describe('the legacy tag form', () => {
	it('renders a bare collection and a pinned slice', () => {
		expect(scopedCachePinKey({ collection: 'articles' })).toBe('articles');

		expect(scopedCachePinKey({
			collection: 'articles',
			field: 'author',
			value: 7,
		})).toBe('articles:author=7');
	});

	it('canonicalises the value the same way the Redis key does', () => {
		// A filter's `true` and a driver's `1` must resolve one slice, not two.
		expect(scopedCachePinKey({
			collection: 'slots',
			field: 'active',
			value: 1,
			type: 'boolean',
		})).toBe('slots:active=true');
	});

	it('joins a set for the header form', () => {
		expect(scopedCachePinKeys([
			scopedCacheFingerprintOf('articles', []),
			scopedCacheFingerprintOf('articles', [{ field: 'author', value: 7 }]),
		]).join(', ')).toBe('articles, articles:author=7');
	});

	// MySQL/MariaDB (`utf8mb4_*_ci`) and MSSQL (`*_CI_AS`) compare strings
	// case-insensitively, so `_eq: 'Acme'` MATCHES a row stored as `acme`: the read
	// pins `tenant=Acme` while the write to that row emits `tenant=acme`, the purge
	// misses, and the entry serves stale for its whole TTL — the same failure the
	// `uuid` branch already folds away. On a case-sensitive vendor the folding merges
	// two slices into one instead: an over-purge, never a stale hit.
	it('folds a string slice to one case, as a case-insensitive vendor does', () => {
		expect(scopedCachePinKey({
			collection: 'orgs',
			field: 'tenant',
			value: 'Acme',
			type: 'string',
		})).toBe('orgs:tenant=acme');

		expect(canonicalizeScopedCachePinValue('ACME', 'string'))
		.toBe(canonicalizeScopedCachePinValue('acme', 'string'));

		// `text` is the same column class one size up, and non-ASCII folds too.
		expect(canonicalizeScopedCachePinValue('Ünïcode Ç', 'text')).toBe('ünïcode ç');
	});

	// countScopedCachePinMembers reads a fingerprint's token back against this
	// string and the entry/purge pin rows join on it, so escaping the null byte
	// here would count zero instead.
	it('keeps a null scope on the null-byte sentinel', () => {
		const nullSlice = {
			collection: 'student_method_range',
			field: 'method',
			value: null,
		};

		expect(scopedCachePinKey(nullSlice))
		.toBe('student_method_range:method=\x00null');
	});
});

// A header throws ERR_INVALID_CHAR on a control byte and a Postgres text column
// rejects the NUL, so both exits render the pin through this one escaper.
describe('the exit form', () => {
	it('escapes the NULL token', () => {
		expect(printableScopedCachePin(scopedCachePinKeys([
			scopedCacheFingerprintOf('student_method_range', [
				{ field: 'method', value: null },
			]),
		]).join(', '))).toBe('student_method_range:method=%00null');
	});

	it('escapes any control byte a string scope value carries', () => {
		expect(printableScopedCachePin('articles:slug=a\u001Fb\u007F'))
		.toBe('articles:slug=a%1Fb%7F');
	});

	it('leaves a printable tag list untouched', () => {
		expect(printableScopedCachePin('articles, articles:author=7'))
		.toBe('articles, articles:author=7');
	});
});

// The blackbox suite covers the rules end to end against a real database; these
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
	// every other slice of it would stay warm on a pin purge built from that key.
	it('reports itself on a self-referencing cascade, and terminates', () => {
		const schema = { relations: [cascadeRelation('node', 'node')] } as any;

		expect(scopedCacheCollectionsChangedByOnDelete(schema, 'node'))
		.toEqual(['node']);
	});

	// Left out here on purpose: the delete snapshots those survivors by key
	// (selfRelationSurvivorKeys), not through this walk's coarse fan-out.
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

describe('countScopedCachePinMembers', () => {
	// A legacy pin names a pin, not a set, so the count is read off the
	// collection's fingerprint sets the way the purge answering it reads them.
	let countedMembers: Record<string, string[]>;

	beforeEach(() => {
		countedMembers = {};

		vi.mocked(useRedis).mockReturnValue({
			sscan: vi.fn(async (indexKey: string) => {
				return ['0', countedMembers[indexKey] ?? []];
			}),
			scan: vi.fn(async (_cursor: string, _match: string, pattern: string) => {
				const scanned = pattern.slice(0, -1);

				return [
					'0',
					Object.keys(countedMembers).filter((indexKey) => {
						return indexKey.startsWith(scanned);
					}),
				];
			}),
		} as any);
	});

	it(oneLine`
		counts the entries each legacy tag reaches: the bare one the reads no value
		narrows, a pinned one the entries bound to that value
	`, async () => {
		countedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:': [
				'articles:&|ns:entry-bare',
				'articles:&id=,5,&|ns:entry-five',
				'articles:&id=,9,&|ns:entry-nine',
			],
		};

		expect(await countScopedCachePinMembers(['articles', 'articles:id=5']))
		.toEqual({ 'articles': 1, 'articles:id=5': 1 });
	});

	it(oneLine`
		counts an entry named by two sets once: a purge frees it once, whatever the
		index files it under
	`, async () => {
		countedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:author=1': [
				'articles:&author=,1,2,&|ns:entry-both',
			],
			'ns:scoped-cache-index:fingerprint:articles:author=2': [
				'articles:&author=,1,2,&|ns:entry-both',
			],
		};

		expect(await countScopedCachePinMembers(['articles:author=1']))
		.toEqual({ 'articles:author=1': 1 });
	});

	// The purge's own `evicted` counts entries, and a blast radius that counted
	// each one's `__expires_at` and `__pins` siblings too would claim three.
	it('leaves an entry\'s sidecars out of its own blast radius', async () => {
		countedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:': [
				'articles:&id=,5,&|ns:entry-five',
				'articles:&id=,5,&|ns:entry-five__expires_at',
				'articles:&id=,5,&|ns:entry-five__pins',
			],
		};

		expect(await countScopedCachePinMembers(['articles:id=5']))
		.toEqual({ 'articles:id=5': 1 });
	});

	it('reads a null scope slice by the legacy tag\'s own byte', async () => {
		countedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:': [
				'articles:&author=,\u0000null,&|ns:entry-unassigned',
			],
		};

		const nullSlice = scopedCachePinKey({
			collection: 'articles',
			field: 'author',
			value: null,
		});

		expect(await countScopedCachePinMembers([nullSlice]))
		.toEqual({ [nullSlice]: 1 });
	});

	it('counts a legacy tag its collection holds nothing for as zero', async () => {
		expect(await countScopedCachePinMembers(['orphan'])).toEqual({ orphan: 0 });
	});

	it('returns {} when scoped purging is disabled', async () => {
		env['CACHE_AUTO_PURGE_MODE'] = 'full';

		expect(await countScopedCachePinMembers(['articles'])).toEqual({});
	});

	it('returns {} for an empty tag list', async () => {
		expect(await countScopedCachePinMembers([])).toEqual({});
	});
});

describe('createScopedCacheHookDeclarations', () => {
	// The collector fills a declared pin's missing type from the schema; these cases
	// name collections it does not carry, so their pins pass through as written.
	const emptySchema = new SchemaBuilder().build();

	// A uuid key is where a missing type bites hardest:
	// `canonicalizeScopedCachePinValue` lowercases a `uuid` and leaves an untyped
	// value alone.
	const notesSchema = new SchemaBuilder()
		.collection('notes', (c) => {
			c.field('id')
				.uuid()
				.primary();
		})
		.build();

	it('records a key whose purge a hook skipped, without adding a pin', () => {
		const { purge, scopeQueryCases, purgeSkippedKeys } =
			createScopedCacheHookDeclarations(emptySchema);

		purge.skipPurgeFor(7);

		expect([...purgeSkippedKeys]).toEqual(['7']);

		// Declaring nothing to purge must not read as declaring a purge: the
		// takeover check keys on the declaration count.
		expect(scopeQueryCases).toEqual([]);
	});

	it(oneLine`
		keeps the EARLIEST counter a scopeTo handed over per collection — a second
		dependent read straddling a purge must not overwrite the value that shows it
	`, () => {
		const { scope, epochs } = createScopedCacheHookDeclarations(emptySchema);

		scope.scopeTo(
			{ collection: 'authors' },
			{ epochs: { authors: '4', '*': '1' } },
		);

		// Read again after a purge of `authors` landed: keeping `9` would compare
		// equal at fill time and cache the response that purge invalidated.
		scope.scopeTo(
			{ collection: 'authors' },
			{ epochs: { authors: '9', files: null } },
		);

		expect(epochs).toEqual({ authors: '4', '*': '1', files: null });
	});

	it(oneLine`
		keeps the earliest counter when a LATER one is declared first — a hook fanning
		its lookups out with allSettled hands them over in completion order, which is
		not the order they were taken in
	`, () => {
		const { scope, epochs } = createScopedCacheHookDeclarations(emptySchema);

		scope.scopeTo({ collection: 'authors' }, { epochs: { authors: '9' } });
		scope.scopeTo({ collection: 'authors' }, { epochs: { authors: '2' } });

		expect(epochs).toEqual({ authors: '2' });
	});

	it(oneLine`
		an absent counter beats any count — that lookup found the collection with no
		counter at all, so a number beside it proves a purge created one in between
	`, () => {
		const { scope, epochs } = createScopedCacheHookDeclarations(emptySchema);

		scope.scopeTo({ collection: 'authors' }, { epochs: { authors: '4' } });
		scope.scopeTo({ collection: 'authors' }, { epochs: { authors: null } });

		expect(epochs).toEqual({ authors: null });
	});

	it(oneLine`
		leaves the counters empty for a scopeTo that handed none over, so respond can
		tell a declared collection apart from a guarded one
	`, () => {
		const { scope, epochs, scopeQueryCases } =
			createScopedCacheHookDeclarations(emptySchema);

		scope.scopeTo({ collection: 'authors' });

		expect(epochs).toEqual({});
		expect(scopeQueryCases).toEqual([[{ collection: 'authors' }]]);
	});

	it('keys skipped purges as strings, so a numeric and a string id agree', () => {
		const { purge, purgeSkippedKeys } =
			createScopedCacheHookDeclarations(emptySchema);

		purge.skipPurgeFor(7);
		purge.skipPurgeFor('7');

		expect([...purgeSkippedKeys]).toEqual(['7']);
	});

	it('scopeTo and purgeBy fill sinks of their own', () => {
		const { scope, purge, scopeQueryCases, purgeFingerprints } =
			createScopedCacheHookDeclarations(emptySchema);

		scope.scopeTo({ collection: 'articles', pinnedScope: { author: [5] } });
		purge.purgeBy({ collection: 'articles', pinnedScope: { author: [5] } });

		// The same slice through both handles, and it lands twice: the read side is
		// composed with the read's own query cases before it becomes a fingerprint,
		// so folding one into the other would purge by a scope nothing declared.
		expect(scopeQueryCases).toEqual([
			[{ collection: 'articles', field: 'author', value: 5 }],
		]);

		expect(purgeFingerprints).toEqual([{
			collection: 'articles',
			pinnedScope: { author: ['5'] },
		}]);
	});

	it(oneLine`
		takes a fingerprint batch, dropping the viewFields a read's own carries: they
		say which columns a read depends on, and no purge reads them
	`, () => {
		const { purge, purgeFingerprints } =
			createScopedCacheHookDeclarations(emptySchema);

		purge.purgeBy([
			{
				collection: 'articles',
				pinnedScope: { author: [5] },
				viewFields: ['title'],
			},
			{
				collection: 'articles',
				pinnedScope: { author: ['5'] },
				viewFields: ['body'],
			},
			{ collection: 'authors' },
		]);

		// Two views of one slice are one thing to purge, and a fingerprint pinning
		// nothing is the whole collection.
		expect(purgeFingerprints).toEqual([
			{ collection: 'articles', pinnedScope: { author: ['5'] } },
			{ collection: 'authors' },
		]);
	});

	it(oneLine`
		reads a pre-fingerprint tag as the slice it names, not as the bare
		collection — which would purge only the reads pinning nothing
	`, () => {
		const { scope, purge, scopeQueryCases, purgeFingerprints } =
			createScopedCacheHookDeclarations(emptySchema);

		const legacyTag = {
			collection: 'articles',
			field: 'author',
			value: 5,
		} as ScopedCacheDeclaredFingerprint;

		scope.scopeTo(legacyTag);
		purge.purgeBy(legacyTag);

		expect(scopeQueryCases).toEqual([
			[{ collection: 'articles', field: 'author', value: 5 }],
		]);

		expect(purgeFingerprints).toEqual([{
			collection: 'articles',
			pinnedScope: { author: ['5'] },
		}]);
	});

	it('accepts a batch, deduping within it and against prior declarations', () => {
		const { scope, scopeQueryCases } =
			createScopedCacheHookDeclarations(emptySchema);

		scope.scopeTo({ collection: 'articles', pinnedScope: { author: [5] } });

		scope.scopeTo([
			{ collection: 'articles', pinnedScope: { author: [5] } },
			{ collection: 'authors' },
			{ collection: 'authors' },
		]);

		// The articles slice repeats the prior one, authors appears twice → each once.
		expect(scopeQueryCases).toEqual([
			[{ collection: 'articles', field: 'author', value: 5 }],
			[{ collection: 'authors' }],
		]);
	});

	it(oneLine`
		keeps the axes of one declared fingerprint together, so the read dies only on
		a write reproducing the whole of it
	`, () => {
		const { scope, scopeQueryCases } =
			createScopedCacheHookDeclarations(emptySchema);

		scope.scopeTo({
			collection: 'articles',
			pinnedScope: { author: [5], status: ['published'] },
		});

		expect(scopeQueryCases).toEqual([[
			{ collection: 'articles', field: 'author', value: 5 },
			{ collection: 'articles', field: 'status', value: 'published' },
		]]);
	});

	it(oneLine`
		dedups on the canonical axis keys — field order and value type collapse
	`, () => {
		const { scope, scopeQueryCases } =
			createScopedCacheHookDeclarations(emptySchema);

		scope.scopeTo({ collection: 'articles', pinnedScope: { author: [7] } });
		// Same slice, the value as a string. A raw JSON compare would keep both; the
		// canonical key collapses them to one.
		scope.scopeTo({ collection: 'articles', pinnedScope: { author: ['7'] } });

		expect(scopeQueryCases).toHaveLength(1);
	});

	it(oneLine`
		fills a type-less tag's type from the schema — the type is what canonicalizes
		the value, so an uppercase uuid a hook names would otherwise resolve a
		different key from the lowercase one the purge side emits for the same row
	`, () => {
		const upper = '07D1AF3C-4B4E-4D6E-9C2A-2F1E0B8A5C31';

		const { scope, purge, scopeQueryCases, purgeFingerprints } =
			createScopedCacheHookDeclarations(notesSchema);

		scope.scopeTo({ collection: 'notes', pinnedScope: { id: [upper] } });
		// The spelling the driver hands the purge side for the very same row.
		purge.purgeBy({ collection: 'notes', pinnedScope: { id: [upper] } });

		expect(scopeQueryCases).toEqual([
			[{ collection: 'notes', field: 'id', value: upper, type: 'uuid' }],
		]);

		expect(scopedCachePinKey(scopeQueryCases[0]![0]!)).toBe(
			`notes:id=${upper.toLowerCase()}`,
		);

		// A fingerprint's tokens are canonicalized the same way, so the pin and the
		// purge name one slice.
		expect(purgeFingerprints).toEqual([{
			collection: 'notes',
			pinnedScope: { id: [upper.toLowerCase()] },
		}]);
	});

	it(oneLine`
		leaves a declaration naming a collection or field the schema doesn't know
		untyped rather than inventing one, and a bare one has no field to look up
	`, () => {
		const { scope, scopeQueryCases } =
			createScopedCacheHookDeclarations(notesSchema);

		scope.scopeTo({ collection: 'ghosts', pinnedScope: { id: ['A'] } });
		scope.scopeTo({ collection: 'notes', pinnedScope: { ghost: ['A'] } });
		scope.scopeTo({ collection: 'notes' });

		expect(scopeQueryCases).toEqual([
			[{ collection: 'ghosts', field: 'id', value: 'A' }],
			[{ collection: 'notes', field: 'ghost', value: 'A' }],
			[{ collection: 'notes' }],
		]);
	});

	it('records the axis keys of a manuallyPurged scopeTo (anomaly-exempt)', () => {
		const { scope, manuallyPurgedKeys } =
			createScopedCacheHookDeclarations(emptySchema);

		scope.scopeTo(
			{ collection: 'articles', pinnedScope: { author: [5] } },
			{ manuallyPurged: true },
		);

		expect([...manuallyPurgedKeys]).toEqual(['articles:author=5']);
	});

	it('leaves a plain scopeTo / purgeBy out of the manuallyPurged set', () => {
		const { scope, purge, manuallyPurgedKeys } =
			createScopedCacheHookDeclarations(emptySchema);

		scope.scopeTo({ collection: 'articles', pinnedScope: { author: [5] } });
		purge.purgeBy({ collection: 'authors' });

		expect(manuallyPurgedKeys.size).toBe(0);
	});

	describe('dependOn', () => {
		// A lookup as `readByQuery` returns it: rows carrying the fingerprints they
		// resolved and the counters the lookup took before its query.
		const acmeMetrics = [{ collection: 'metric', field: 'owner', value: 'acme' }];

		const metricLookup = () => {
			return withMeta(
				[{ id: 1 }],
				{
					scopedCacheFingerprints: [
						{
							collection: 'metric',
							pinnedScope: { owner: ['acme'] },
						},
					],
					scopedCacheEpochs: { metric: '4' },
				},
			);
		};

		const auditLookup = () => {
			return withMeta(
				[{ id: 2 }],
				{
					scopedCacheFingerprints: [{
						collection: 'audit',
					}],
					scopedCacheEpochs: { audit: '7' },
				},
			);
		};

		it('folds a pending lookup and hands its rows back', async () => {
			const { scope, scopeQueryCases, epochs } =
				createScopedCacheHookDeclarations(emptySchema);

			const rows = await scope.dependOn(Promise.resolve(metricLookup()));

			expect(rows).toEqual([{ id: 1 }]);
			expect(scopeQueryCases).toEqual([acmeMetrics]);
			expect(epochs).toEqual({ metric: '4' });
		});

		it('takes an already-resolved lookup the same way', async () => {
			const { scope, scopeQueryCases, epochs } =
				createScopedCacheHookDeclarations(emptySchema);

			await scope.dependOn(metricLookup());

			expect(scopeQueryCases).toEqual([acmeMetrics]);
			expect(epochs).toEqual({ metric: '4' });
		});

		it(oneLine`
			walks a Promise.all batch — a result is itself an array, so the meta rider is
			what tells one lookup from the batch holding it
		`, async () => {
			const { scope, scopeQueryCases, epochs } =
				createScopedCacheHookDeclarations(emptySchema);

			const batch = await scope.dependOn(
				Promise.all([metricLookup(), auditLookup()]),
			);

			expect(batch).toHaveLength(2);
			expect(scopeQueryCases).toEqual([acmeMetrics, [{ collection: 'audit' }]]);

			expect(epochs).toEqual({ metric: '4', audit: '7' });
		});

		it(oneLine`
			folds the fulfilled verdicts of a Promise.allSettled batch and passes the
			rejected one through for the caller to judge
		`, async () => {
			const { scope, scopeQueryCases, epochs } =
				createScopedCacheHookDeclarations(emptySchema);

			const verdicts = await scope.dependOn(
				Promise.allSettled([metricLookup(), Promise.reject(new Error('gone'))]),
			);

			expect(verdicts.map((verdict) => verdict.status))
				.toEqual(['fulfilled', 'rejected']);

			expect(scopeQueryCases).toEqual([acmeMetrics]);
			expect(epochs).toEqual({ metric: '4' });
		});

		it(oneLine`
			folds each lookup on its own, so two lookups of one collection straddling a
			purge are judged on the earlier counter
		`, async () => {
			const { scope, epochs } = createScopedCacheHookDeclarations(emptySchema);

			const before = withMeta(
				[{ id: 1 }],
				{
					scopedCacheFingerprints: [{
						collection: 'metric',
					}],
					scopedCacheEpochs: { metric: '4' },
				},
			);

			const after = withMeta(
				[{ id: 1 }],
				{
					scopedCacheFingerprints: [{
						collection: 'metric',
					}],
					scopedCacheEpochs: { metric: '5' },
				},
			);

			await scope.dependOn([after, before]);

			expect(epochs).toEqual({ metric: '4' });
		});

		it('never marks a folded declaration manuallyPurged', async () => {
			const { scope, manuallyPurgedKeys } =
				createScopedCacheHookDeclarations(emptySchema);

			await scope.dependOn(metricLookup());

			expect(manuallyPurgedKeys.size).toBe(0);
		});

		it('adds nothing for a value carrying no meta rider', async () => {
			const { scope, scopeQueryCases, epochs } =
				createScopedCacheHookDeclarations(emptySchema);

			const rows = await scope.dependOn([{ id: 1 }]);

			expect(rows).toEqual([{ id: 1 }]);
			expect(scopeQueryCases).toEqual([]);
			expect(epochs).toEqual({});
		});
	});
});

describe('a collection-wide purge', () => {
	it('reads a collection purge off the collection\'s fingerprint sets', async () => {
		const scan = vi.fn().mockResolvedValue(['0', []]);
		const smembers = vi.fn();

		vi.mocked(useRedis).mockReturnValue({
			smembers,
			scan,
			srem: vi.fn(),
			eval: vi.fn().mockResolvedValue([]),
			pipeline: () => redisPipelineDouble(),
		} as any);

		await purgeCollectionScopedCache({ delete: vi.fn() } as any, 'articles');

		expect(scan).toHaveBeenCalledWith(
			'0',
			'MATCH',
			'ns:scoped-cache-index:fingerprint:articles:*',
			'COUNT',
			1000,
		);

		expect(smembers).not.toHaveBeenCalled();
	});

	it(oneLine`
		bumps the counter BEFORE scanning the collection's sets — a read filing a new
		fingerprint between that scan and the sweep is missed by this purge, and the
		bump is what makes it decline instead of surviving under a set nothing swept
	`, async () => {
		const calls: string[] = [];

		const pipeline = {
			incr: (key: string) => {
				calls.push(`incr ${key}`);
				return pipeline;
			},
			expire: () => pipeline,
			exec: async () => {
				calls.push('exec');
				return [];
			},
		};

		vi.mocked(useRedis).mockReturnValue({
			scan: async (_cursor: string, _match: string, pattern: string) => {
				calls.push(`scan ${pattern}`);
				return ['0', ['ns:scoped-cache-index:fingerprint:articles:']];
			},
			del: vi.fn(),
			srem: vi.fn(),
			eval: async () => {
				calls.push('eval');
				return [];
			},
			pipeline: () => pipeline,
		} as any);

		await purgeCollectionScopedCache({ delete: vi.fn() } as any, 'articles');

		expect(calls).toEqual([
			'incr ns:scoped-cache-epoch:articles',
			'exec',
			'scan ns:scoped-cache-index:fingerprint:articles:*',
			'eval',
		]);
	});

});

// The pipeline a purge still sends carries only its epoch bumps; the sweep itself is
// one script, doubled by `redisSweepDouble` below.
function redisPipelineDouble() {
	const chain = {
		incr: () => chain,
		expire: () => chain,
		exec: async () => [],
	};

	return chain;
}

/**
 * Stand in for the sweep script: read each index set and drop them all. `members` is
 * what the sets between them hold, and the recorded `swept` is what a case asserts
 * the sweep asked for — the script does it inside Redis, so there is no command of
 * its own to spy on.
 */
function redisSweepDouble(members: () => Promise<string[]>) {
	const swept: string[][] = [];

	return {
		swept,
		eval: vi.fn(async (
			_script: string,
			numKeys: number,
			...args: string[]
		) => {
			swept.push(args.slice(0, numKeys));

			return members();
		}),
	};
}

describe('indexScopedCacheEntry', () => {
	it(oneLine`
		throws the command error a pipeline REPLIED with, so its caller can skip
		writing an entry that would be indexed under nothing
	`, async () => {
		const refused = new Error(
			'OOM command not allowed when used memory > maxmemory',
		);

		vi.mocked(useRedis).mockReturnValue({
			defineCommand: vi.fn(),
			pipeline: () => {
				return {
					sadd: vi.fn().mockReturnThis(),
					scopedCacheTagExpiry: vi.fn().mockReturnThis(),
					expire: vi.fn().mockReturnThis(),
					persist: vi.fn().mockReturnThis(),
					// ioredis reports a refused command in the reply array and only
					// REJECTS on a connection-level failure, so an ignored reply
					// reads as success.
					exec: vi.fn().mockResolvedValue([[null, 1], [refused, null]]),
				};
			},
		} as any);

		await expect(indexScopedCacheEntry('entry', [
			{ collection: 'articles', pinnedScope: { author: ['7'] } },
		])).rejects.toBe(refused);
	});

	it(oneLine`
		only ever extends an index set's expiry, so a later write carrying a shorter
		TTL cannot outlive-orphan the entries an earlier one indexed
	`, async () => {
		const tagExpiry = vi.fn().mockReturnThis();
		const expire = vi.fn().mockReturnThis();
		env['CACHE_TTL'] = '30m';

		vi.mocked(useRedis).mockReturnValue({
			defineCommand: vi.fn(),
			pipeline: () => {
				return {
					sadd: vi.fn().mockReturnThis(),
					expire,
					scopedCacheTagExpiry: tagExpiry,
					exec: vi.fn().mockResolvedValue([]),
				};
			},
		} as any);

		try {
			await indexScopedCacheEntry('entry', [
				{ collection: 'articles', pinnedScope: { author: ['7'] } },
			]);
		}
		finally {
			delete env['CACHE_TTL'];
		}

		// An index set is SHARED by every entry the collection files there, and a
		// bare EXPIRE overwrites: lower CACHE_TTL at runtime and one short write
		// cuts short the set indexing an entry cached for an hour, which no purge
		// can then reach.
		expect(expire).not.toHaveBeenCalled();

		expect(tagExpiry).toHaveBeenCalledWith(
			'ns:scoped-cache-index:fingerprint:articles:',
			3600,
			'articles:&author=,7,&|entry',
			'articles:&author=,7,&|entry__expires_at',
		);
	});

	it(oneLine`
		clears an index set's expiry under a TTL of 0, since the entries it names
		then never expire
	`, async () => {
		const sadd = vi.fn().mockReturnThis();
		const persist = vi.fn().mockReturnThis();

		vi.mocked(useRedis).mockReturnValue({
			defineCommand: vi.fn(),
			pipeline: () => {
				return {
					sadd,
					persist,
					scopedCacheTagExpiry: vi.fn().mockReturnThis(),
					exec: vi.fn().mockResolvedValue([]),
				};
			},
		} as any);

		await indexScopedCacheEntry(
			'entry',
			[{ collection: 'articles', pinnedScope: { author: ['7'] } }],
			[],
			{ collections: {}, relations: [] },
			'0',
		);

		// A set filed while a TTL was in force keeps that expiry through a plain
		// SADD, and expires under entries that no purge can reach any more.
		expect(sadd).toHaveBeenCalledWith(
			'ns:scoped-cache-index:fingerprint:articles:',
			'articles:&author=,7,&|entry',
			'articles:&author=,7,&|entry__expires_at',
		);

		expect(persist).toHaveBeenCalledWith(
			'ns:scoped-cache-index:fingerprint:articles:',
		);
	});
});

describe('dropScopedCacheIndex', () => {
	function mockScan(...pages: [string, string[]][]) {
		const scan = vi.fn();

		for (const page of pages) {
			scan.mockResolvedValueOnce(page);
		}

		const pipeline = unlinkPipeline();

		const redis = { scan, pipeline: () => pipeline };

		vi.mocked(useRedis).mockReturnValue(redis as any);

		return { scan, unlink: pipeline.unlink };
	}

	it(oneLine`
		asks Redis for the index keys alone, and unlinks what comes back
	`, async () => {
		const { scan, unlink } = mockScan(
			['4', [
				'ns:scoped-cache-index:fingerprint:articles',
				'ns:scoped-cache-index:slices:articles',
			]],
			['0', [
				'ns:scoped-cache-index:fingerprint:articles:id=1',
				'ns:scoped-cache-index:fingerprint:authors',
			]],
		);

		const dropped = await dropScopedCacheIndex();

		// `MATCH` filters server-side, so a pattern that covered the index by being
		// wider than it — `ns:*` — put every cache-stats tombstone and fill-guard
		// epoch key on the wire to be dropped again here. Measured on the dev
		// keyspace: 84 keys shipped to unlink 0.
		expect(scan).toHaveBeenCalledTimes(2);

		expect(scan).toHaveBeenCalledWith(
			'0',
			'MATCH',
			'ns:scoped-cache-index:*',
			'COUNT',
			1000,
		);

		expect(scan).toHaveBeenCalledWith(
			'4',
			'MATCH',
			'ns:scoped-cache-index:*',
			'COUNT',
			1000,
		);

		// ONE array argument, never a spread: the SCAN result is unbounded, and
		// spreading it past the stack's headroom throws RangeError.
		//
		// One call per scan page, not one for the lot: collecting first would put
		// the whole index in this process's heap to delete it from Redis.
		expect(unlink).toHaveBeenNthCalledWith(1, [
			'ns:scoped-cache-index:fingerprint:articles',
			'ns:scoped-cache-index:slices:articles',
		]);

		expect(unlink).toHaveBeenNthCalledWith(2, [
			'ns:scoped-cache-index:fingerprint:articles:id=1',
			'ns:scoped-cache-index:fingerprint:authors',
		]);

		expect(dropped).toEqual({ dropped: 4, refused: 0 });
	});

	it(oneLine`
		moves the wholesale counter again once the index is gone — a fill that filed
		before the drop and wrote its entry after it is indexed by nothing
	`, async () => {
		const { scan } = mockScan(['0', ['ns:scoped-cache-index:fingerprint:articles']]);
		const { incr } = vi.mocked(useRedis)().pipeline();

		await dropScopedCacheIndex();

		expect(scan).toHaveBeenCalledOnce();
		expect(incr).toHaveBeenCalledExactlyOnceWith('ns:scoped-cache-epoch:*');
	});

	it(oneLine`
		sweeps a long list of index sets in bounded batches — the whole page is spread
		into the script call, and a spread long enough throws RangeError before Redis
		is reached (#397), taking a purge that can then never complete on retry
	`, async () => {
		const sweep = redisSweepDouble(async () => []);

		// One set per index value, which is what a per-user-scoped collection
		// accumulates.
		const indexKeys = Array.from({ length: 1_201 }, (_unused, index) => {
			return `ns:scoped-cache-index:fingerprint:articles:owner=${index}`;
		});

		vi.mocked(useRedis).mockReturnValue({
			scan: vi.fn().mockResolvedValue(['0', indexKeys]),
			del: vi.fn(),
			srem: vi.fn(),
			eval: sweep.eval,
			pipeline: () => redisPipelineDouble(),
		} as any);

		await purgeCollectionScopedCache({ delete: vi.fn() } as any, 'articles');

		expect(sweep.swept.flat()).toHaveLength(1_201);
		expect(sweep.swept).toHaveLength(3);

		for (const batch of sweep.swept) {
			expect(batch.length).toBeLessThanOrEqual(500);
		}

		// Every set still swept exactly once: batching must not drop or repeat one.
		expect(new Set(sweep.swept.flat()).size).toBe(1_201);
	});

	it(oneLine`
		moves the counters even when the sweep behind them is refused, so a read in
		flight declines rather than caching under an index the retry will drop
	`, async () => {
		const bumped: string[] = [];

		const pipeline = {
			incr: (key: string) => {
				bumped.push(key);
				return pipeline;
			},
			expire: () => pipeline,
			exec: async () => [],
		};

		vi.mocked(useRedis).mockReturnValue({
			smembers: vi.fn().mockResolvedValue([]),
			del: vi.fn(),
			srem: vi.fn(),
			eval: vi.fn().mockRejectedValue(new Error('Connection is closed.')),
			pipeline: () => pipeline,
		} as any);

		await purgeScopedCache(
			{ delete: vi.fn() } as any,
			'articles',
			[scopedCacheFingerprintOf('articles', [
				{ field: 'author', value: 7 },
			])],
		);

		// The bumps are their own pipeline, sent before the script — inside it they
		// would have gone down with the refusal.
		expect(bumped).toEqual(['ns:scoped-cache-epoch:articles']);
	});

	it('counts what Redis removed, not what it was handed', async () => {
		const { unlink } = mockScan(
			['0', [
				'ns:scoped-cache-index:fingerprint:a',
				'ns:scoped-cache-index:fingerprint:b',
			]],
		);

		// A pipeline reports per command, so a chunk that failed is a chunk still
		// there — and a flush logging the input count names a number that never
		// happened.
		unlink.mock.results.length = 0;

		vi.mocked(useRedis)().pipeline().exec = vi.fn().mockResolvedValue([
			[new Error('LOADING Redis is loading the dataset in memory'), null],
		]);

		// Counted, not just skipped: a caller handed 0 with no refusals cannot tell
		// an index Redis would not touch from one that was already empty.
		expect(await dropScopedCacheIndex())
		.toEqual({ dropped: 0, refused: 1 });
	});

	it('splits the drop into chunked commands', async () => {
		const keys = Array.from(
			{ length: 2500 },
			(_, at) => `ns:scoped-cache-index:fingerprint:c:id=${at}`,
		);

		const { unlink } = mockScan(['0', keys]);

		await dropScopedCacheIndex();

		// Redis runs one command at a time, so a single UNLINK of the whole scan
		// holds the server for its own O(keys) work in front of every other client.
		expect(unlink).toHaveBeenCalledTimes(3);
		expect(unlink).toHaveBeenNthCalledWith(1, keys.slice(0, 1000));
		expect(unlink).toHaveBeenNthCalledWith(2, keys.slice(1000, 2000));
		expect(unlink).toHaveBeenNthCalledWith(3, keys.slice(2000));
	});

	it('no-ops (never UNLINKs an empty list) when nothing matches', async () => {
		const { unlink } = mockScan(['0', []]);

		const dropped = await dropScopedCacheIndex();

		expect(unlink).not.toHaveBeenCalled();
		expect(dropped).toEqual({ dropped: 0, refused: 0 });
	});

	it('no-ops when Redis is unavailable', async () => {
		vi.mocked(redisConfigAvailable).mockReturnValue(false);
		const { scan } = mockScan(['0', []]);

		expect(await dropScopedCacheIndex())
		.toEqual({ dropped: 0, refused: 0 });

		expect(scan).not.toHaveBeenCalled();
	});

	// The keys the pre-scoped-cache-index layout wrote go once, in
	// `20260911A-drop-the-pre-scoped-cache-index-layout`, not on every flush.
	it('walks the index prefix and nothing else', async () => {
		const { scan } = mockScan(['0', ['ns:scoped-cache-index:fingerprint:articles']]);

		await dropScopedCacheIndex();

		expect(scan).toHaveBeenCalledTimes(1);

		expect(scan)
		.toHaveBeenCalledWith('0', 'MATCH', 'ns:scoped-cache-index:*', 'COUNT', 1000);
	});
});

describe('flushResponseCache', () => {
	function recordFlush() {
		const calls: string[] = [];

		const pipeline = {
			incr: (key: string) => {
				calls.push(`incr ${key}`);
				return pipeline;
			},
			expire: () => pipeline,
			unlink: () => {
				calls.push('unlink');
				return pipeline;
			},
			exec: async () => {
				calls.push('exec');
				return [];
			},
		};

		vi.mocked(useRedis).mockReturnValue({
			scan: async () => {
				calls.push('scan');
				return ['0', ['ns:scoped-cache-index:fingerprint:articles']];
			},
			pipeline: () => pipeline,
		} as any);

		const cache = {
			clear: vi.fn(async () => {
				calls.push('clear');
			}),
		} as unknown as Keyv;

		return { calls, cache };
	}

	it(oneLine`
		moves the wholesale counter BEFORE the clear, drops the index, then moves it
		again — a read rechecking between a clear and a move made after it keeps an
		entry the index drop then orphans
	`, async () => {
		const { calls, cache } = recordFlush();

		await flushResponseCache(cache);

		expect(calls).toEqual([
			'incr ns:scoped-cache-epoch:*',
			'exec',
			'clear',
			'scan',
			'unlink',
			'exec',
			'incr ns:scoped-cache-epoch:*',
			'exec',
		]);
	});

	it(oneLine`
		moves the counter with no cache to clear — the reads in flight are what the
		move is for, and they snapshot it whether or not anything was stored
	`, async () => {
		const { calls } = recordFlush();

		await flushResponseCache(null);

		expect(calls).toEqual([
			'incr ns:scoped-cache-epoch:*',
			'exec',
			'scan',
			'unlink',
			'exec',
			'incr ns:scoped-cache-epoch:*',
			'exec',
		]);
	});

	it(oneLine`
		clears and nothing more with scoped purging off — there is no counter a read
		snapshot and no index to drop, and the scan would still walk the whole
		keyspace on every permission, field or collection change
	`, async () => {
		const { calls, cache } = recordFlush();
		env['CACHE_AUTO_PURGE_MODE'] = 'full';

		await flushResponseCache(cache);

		expect(calls).toEqual(['clear']);
	});

	it(oneLine`
		answers when the index scan is refused — a system service runs this in a
		\`finally\` after its write committed, and a throw here would fail that
		request over a cache the clear already left to Keyv to swallow
	`, async () => {
		const { calls, cache } = recordFlush();
		const warn = vi.fn();
		vi.mocked(useLogger).mockReturnValue({ info: vi.fn(), warn } as any);

		vi.mocked(useRedis)().scan = async () => {
			throw new Error('ECONNREFUSED');
		};

		await expect(flushResponseCache(cache)).resolves.toBeUndefined();

		expect(calls).toEqual([
			'incr ns:scoped-cache-epoch:*',
			'exec',
			'clear',
			'incr ns:scoped-cache-epoch:*',
			'exec',
		]);

		expect(warn).toHaveBeenCalledWith(
			expect.any(Error),
			expect.stringContaining('index'),
		);
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

	// What the fingerprint sets hold, keyed by the set a case expects the drain to
	// read. A record names a pin, never the set holding it — the schema it was
	// written under is gone by now — so the drain finds the sets by scanning the
	// collection's own prefix, and a case declares them here.
	let indexedMembers: Record<string, string[]>;

	// The index prune rides a pipeline, so a member the drain dropped reads off this
	// rather than off the client.
	const srem = vi.fn();

	// A collection-mode record drops whole sets through the sweep script, which does
	// its work inside Redis and leaves no command of its own to spy on.
	const swept: string[][] = [];

	const redis = {
		sscan: vi.fn(async (indexKey: string, _cursor: string) => {
			return ['0', indexedMembers[indexKey] ?? []];
		}),
		scan: vi.fn(async (_cursor: string, _match: string, pattern: string) => {
			const scanned = pattern.slice(0, -1);

			return [
				'0',
				Object.keys(indexedMembers).filter((indexKey) => {
					return indexKey.startsWith(scanned);
				}),
			];
		}),
		eval: vi.fn(async (_script: string, numKeys: number, ...args: string[]) => {
			const sweptKeys = args.slice(0, numKeys);
			swept.push(sweptKeys);

			return sweptKeys.flatMap((indexKey) => indexedMembers[indexKey] ?? []);
		}),
		del: vi.fn(),
		pipeline: () => {
			const chain: any = {
				incr: () => chain,
				expire: () => chain,
				srem: (...args: string[]) => {
					srem(...args);
					return chain;
				},
				exec: async () => [],
			};

			return chain;
		},
	};

	beforeEach(() => {
		vi.mocked(getCache).mockReturnValue({ cache } as any);
		vi.mocked(useRedis).mockReturnValue(redis as any);
		indexedMembers = {};
		swept.length = 0;

		// The shape a deployment with CACHE_STATS off returns for every entry, so a
		// case has to opt IN to being able to name what it recovered.
		vi.mocked(readCacheDescriptorForRedisKey).mockResolvedValue(null);
	});

	it(oneLine`
		rebuilds a recorded fingerprint against the namespace in force AT RETRY TIME, so
		a CACHE_NAMESPACE change between the failure and the retry cannot misaim it
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheFingerprints: ['articles:&id=,1,&'],
			ids: [7],
		}]);

		// The fingerprint was recorded under `ns`; the process now runs under `other`.
		env['CACHE_NAMESPACE'] = 'other';

		indexedMembers = {
			'other:scoped-cache-index:fingerprint:articles:': [
				'articles:&id=,1,&|ns:entry-a',
			],
		};

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(redis.scan).toHaveBeenCalledWith(
			'0',
			'MATCH',
			'other:scoped-cache-index:fingerprint:articles:*',
			'COUNT',
			expect.any(Number),
		);

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-a');
		expect(clearPendingScopedCachePurges).toHaveBeenCalledWith([7]);
	});

	it(oneLine`
		records what it finished as a purge, with no latency: the page counts a
		recovered entry as purged like any other, and no write waited on it (#507)
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheFingerprints: ['articles:&id=,1,&'],
				ids: [7],
			},
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheFingerprints: ['articles:&id=,2,&'],
				ids: [8],
			},
		]);

		indexedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:': [
				'articles:&id=,1,&|ns:entry-a',
			],
		};

		expect(await retryPendingScopedCachePurges()).toBe(2);

		expect(queueCachePurge).toHaveBeenCalledTimes(2);

		expect(queueCachePurge).toHaveBeenCalledWith({
			purgeId: expect.any(String),
			collection: 'articles',
			mode: 'slices',
			// The record holds fingerprints, the stats stream takes pins: it joins
			// its pin list with a comma, which a rendered fingerprint carries raw.
			scopedCachePins: ['articles:id=1'],
			scopedCachePinCount: 1,
			evicted: 1,
			durationMs: null,
		});

		// One id across the drain, so an entry two of its targets reach counts one
		// purge.
		const [first, second] = vi.mocked(queueCachePurge).mock.calls;
		expect(second![0].purgeId).toBe(first![0].purgeId);
	});

	it(oneLine`
		takes every set the index names for a collection-mode record — it named no
		fingerprint because which slices changed was unresolvable when it failed
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'collection',
			collection: 'articles',
			scopedCacheFingerprints: [],
			ids: [7],
		}]);

		indexedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:': [
				'articles:&|ns:entry-bare',
			],
			'ns:scoped-cache-index:fingerprint:articles:owner=alpha': [
				'articles:&owner=,alpha,&|ns:entry-alpha',
			],
		};

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(swept).toEqual([[
			'ns:scoped-cache-index:fingerprint:articles:',
			'ns:scoped-cache-index:fingerprint:articles:owner=alpha',
		]]);

		expect(cache.clear).not.toHaveBeenCalled();

		expect(queueCachePurge).toHaveBeenCalledWith(expect.objectContaining({
			collection: 'articles',
			mode: 'collection',
			durationMs: null,
		}));
	});

	it(oneLine`
		purges a whole collection for a record naming it by its legacy tag — a row
		written before the fingerprint index existed says which collection went stale
		and nothing narrower, so its reach is the collection
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheFingerprints: ['articles:id=1'],
			ids: [7],
		}]);

		indexedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:owner=alpha': [
				'articles:&owner=,alpha,&|ns:entry-alpha',
			],
		};

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(swept)
			.toEqual([['ns:scoped-cache-index:fingerprint:articles:owner=alpha']]);

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-alpha');

		// Recorded by the collection purge itself, which is the one that knows how
		// many sets its scan turned up — counting it here as well would report the
		// same entries evicted twice.
		expect(queueCachePurge).toHaveBeenCalledOnce();

		expect(queueCachePurge).toHaveBeenCalledWith(expect.objectContaining({
			collection: 'articles',
			mode: 'collection',
		}));
	});

	it(oneLine`
		purges a whole collection for a legacy tag whose value ends in an ampersand —
		it is no fingerprint, and read as one it pins nothing the index files
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheFingerprints: ['articles:title=Q&'],
			ids: [7],
		}]);

		indexedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:owner=alpha': [
				'articles:&title=,q,&|ns:entry-alpha',
			],
		};

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-alpha');

		expect(queueCachePurge).toHaveBeenCalledWith(expect.objectContaining({
			collection: 'articles',
			mode: 'collection',
		}));
	});

	it('flushes the whole namespace for a namespace-mode record', async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'namespace',
			collection: null,
			scopedCacheFingerprints: [],
			ids: [7],
		}]);

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(cache.clear).toHaveBeenCalledOnce();
		expect(swept).toEqual([]);
		expect(clearPendingScopedCachePurges).toHaveBeenCalledWith([7]);

		expect(queueCachePurge).toHaveBeenCalledWith(expect.objectContaining({
			collection: null,
			mode: 'namespace',
			evicted: null,
			durationMs: null,
		}));
	});

	it(oneLine`
		keeps a record whose retry failed again and counts the attempt, then carries on
		to the targets behind it
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheFingerprints: ['articles:&id=,1,&'],
				ids: [7],
			},
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheFingerprints: ['articles:&id=,2,&'],
				ids: [8],
			},
		]);

		const closed = new Error('Connection is closed.');

		// Fails the scan that finds the sets rather than a descriptor read: naming the
		// stale entries has a guard of its own that swallows a failure, so injecting it
		// there would prove nothing about the purge.
		redis.scan.mockRejectedValueOnce(closed);

		expect(await retryPendingScopedCachePurges()).toBe(1);

		expect(countFailedScopedCachePurgeRetry).toHaveBeenCalledWith([7], closed);
		expect(clearPendingScopedCachePurges).not.toHaveBeenCalledWith([7]);
		expect(clearPendingScopedCachePurges).toHaveBeenCalledWith([8]);
	});

	it(oneLine`
		keeps the record when redis REFUSES the read rather than dropping the
		connection — the shape maxmemory with noeviction and a demoted primary both
		take, where reads are served and the write behind them is not
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheFingerprints: ['articles:&id=,1,&'],
			ids: [7],
		}]);

		// A refused command rejects the purge before anything is dropped OR pruned, so
		// both are left in place for the retry to come back for.
		redis.scan.mockRejectedValueOnce(new Error('OOM command not allowed'));

		expect(await retryPendingScopedCachePurges()).toBe(0);

		expect(countFailedScopedCachePurgeRetry)
			.toHaveBeenCalledWith([7], expect.any(Error));

		expect(clearPendingScopedCachePurges).not.toHaveBeenCalledWith([7]);
	});

	it(oneLine`
		still purges when naming the stale entries fails — the report is best-effort and
		the purge is the correctness step, so a descriptor read must not gate it
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheFingerprints: ['articles:&id=,1,&'],
			ids: [7],
		}]);

		indexedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:': [
				'articles:&id=,1,&|ns:entry-a',
			],
		};

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
			scopedCacheFingerprints: [],
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
			scopedCacheFingerprints: ['articles:&id=,1,&'],
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
			scopedCacheFingerprints: ['articles:&id=,1,&'],
			ids: [7],
		}];

		vi.mocked(listPendingScopedCachePurges).mockImplementation(async () => rows);

		vi.mocked(clearPendingScopedCachePurges).mockImplementation(async () => {
			rows = [];
		});

		indexedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:': [
				'articles:&id=,1,&|ns:entry-a',
			],
		};

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
			scopedCacheFingerprints: [],
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
			scopedCacheFingerprints: ['articles:&id=,1,&'],
			ids: [7],
		}]);

		indexedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:': [
				'articles:&id=,1,&|ns:entry-a',
			],
		};

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
			scopedCacheFingerprints: ['articles:&id=,1,&'],
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
		names each entry it found stale, counting the sidecars filed beside it as the
		entry they belong to rather than as two more
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheFingerprints: ['articles:&id=,1,&'],
			ids: [7],
		}]);

		indexedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:': [
				'articles:&id=,1,&|ns:entry-a',
				'articles:&id=,1,&|ns:entry-a__expires_at',
				'articles:&id=,1,&|ns:entry-a__pins',
			],
		};

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

	// An entry is filed under every query case it was cached for, and one failed
	// mutation records one row per target (#507): naming it per target reported the
	// same entry as many times as the drain had targets for it.
	it(oneLine`
		names an entry once per drain, not once per target it is filed under
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheFingerprints: ['articles:&id=,1,&'],
				ids: [7],
			},
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheFingerprints: ['articles:&author=,3,&'],
				ids: [8],
			},
		]);

		// One entry both targets reach: it is bound to the row one names and to the
		// author the other does.
		indexedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:': [
				'articles:&author=,3,&id=,1,&|ns:entry-a',
			],
		};

		vi.mocked(readCacheDescriptorForRedisKey)
			.mockResolvedValue({ cacheKey: 'GET /items/articles/1' } as any);

		await retryPendingScopedCachePurges();

		expect(queueCacheAnomaly).toHaveBeenCalledOnce();
	});

	it(oneLine`
		purges an entry whose descriptor is gone all the same — stats were off when it
		was filled, so it can be dropped but not named
	`, async () => {
		vi.mocked(listPendingScopedCachePurges).mockResolvedValue([{
			mode: 'slices',
			collection: 'articles',
			scopedCacheFingerprints: ['articles:&id=,1,&'],
			ids: [7],
		}]);

		indexedMembers = {
			'ns:scoped-cache-index:fingerprint:articles:': [
				'articles:&id=,1,&|ns:entry-a',
			],
		};

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

	it(oneLine`
		logs rather than leaves an unhandled rejection when the response cache cannot
		be reached to watch its own client
	`, async () => {
		const warn = vi.fn();
		vi.mocked(useLogger).mockReturnValue({ info: vi.fn(), warn } as any);
		vi.mocked(useRedis).mockReturnValue({ on: vi.fn() } as any);

		// `getCache` builds the store on its first call, so it throws here on a boot
		// path — where an unhandled rejection is the process's problem rather than
		// this listener's. The other two triggers still cover the drain.
		vi.mocked(getCache).mockImplementation(() => {
			throw new Error('cache store unavailable');
		});

		startScopedCachePurgeRecovery();

		// Named, not merely counted: the drain reaches `getCache` too, so a bare
		// "something warned" would pass with the listener's own rejection unhandled.
		await vi.waitFor(() => {
			expect(warn).toHaveBeenCalledWith(
				expect.anything(),
				expect.stringContaining('could not watch the response cache client'),
			);
		});
	});

	it('reports the count once there was something to finish', async () => {
		const info = vi.fn();
		vi.mocked(useLogger).mockReturnValue({ info, warn: vi.fn() } as any);
		const onRedisEvent = vi.fn();
		vi.mocked(useRedis).mockReturnValue({ on: onRedisEvent } as any);

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
			scopedCacheFingerprints: [],
			ids: [7],
		}]);

		startScopedCachePurgeRecovery();

		// Every drain queues behind the one before it, process-wide, so the boot pass
		// this call starts can still be waiting on the drains the tests above left
		// running. `ready` is a real second trigger and queues a pass of its own.
		const ready = onRedisEvent.mock.calls.find(([event]) => event === 'ready');
		expect(ready).toBeDefined();
		ready![1]();

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
			scan: vi.fn().mockResolvedValue(['0', []]),
			srem: vi.fn(),
			eval: vi.fn().mockResolvedValue([]),
			pipeline: () => redisPipelineDouble(),
		} as any);

		vi.mocked(emitter.emitFilter).mockImplementation(async (_e, tags) => tags);
		cache.clear.mockResolvedValue(undefined);
	});

	it(oneLine`
		records the slices it could not drop, and reports no purge it did not run
	`, async () => {
		vi.mocked(useRedis).mockReturnValue({
			scan: vi.fn().mockRejectedValue(closed),
			sscan: vi.fn().mockRejectedValue(closed),
			eval: vi.fn().mockRejectedValue(closed),
			pipeline: () => redisPipelineDouble(),
		} as any);

		const purged = await purgeScopedCache(cache as any, 'articles', [
			scopedCacheFingerprintOf('articles', [{ field: 'id', value: 1 }]),
		]);

		expect(recordPendingScopedCachePurge).toHaveBeenCalledWith(
			{
				mode: 'slices',
				collection: 'articles',
				scopedCacheFingerprints: ['articles:&', 'articles:&id=,1,&'],
			},
			closed,
		);

		// Still answered with the fingerprints the mutation resolved — the caller's
		// dev header names what SHOULD have gone, and the recovery is what makes
		// that true.
		expect(purged).toEqual([
			scopedCacheFingerprintOf('articles', []),
			scopedCacheFingerprintOf('articles', [{ field: 'id', value: 1 }]),
		]);

		expect(queueCachePurge).not.toHaveBeenCalled();
	});

	it(oneLine`
		records the collection when the slices were unresolvable and reading the
		collection's own index sets failed too
	`, async () => {
		vi.mocked(useRedis).mockReturnValue({
			scan: vi.fn().mockRejectedValue(closed),
			sscan: vi.fn().mockRejectedValue(closed),
			eval: vi.fn().mockRejectedValue(closed),
			pipeline: () => redisPipelineDouble(),
		} as any);

		expect(await purgeScopedCache(cache as any, 'articles', null))
			.toEqual([{ collection: 'articles' }]);

		expect(recordPendingScopedCachePurge).toHaveBeenCalledWith(
			{ mode: 'collection', collection: 'articles', scopedCacheFingerprints: [] },
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
			{ mode: 'namespace', collection: null, scopedCacheFingerprints: [] },
			closed,
		);

		expect(queueCachePurge).not.toHaveBeenCalled();
	});

	it('records nothing, and reports the purge, when it went through', async () => {
		await purgeScopedCache(cache as any, 'articles', [
			scopedCacheFingerprintOf('articles', [{ field: 'id', value: 1 }]),
		]);

		expect(recordPendingScopedCachePurge).not.toHaveBeenCalled();
		expect(queueCachePurge).toHaveBeenCalledOnce();
	});
});

describe('scopedCachePinsFromM2oParents', () => {
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
		// Two sub-items under distinct items but ONE owner: the owner pin must not
		// come out twice, and the item pins must not collapse to one.
		const pinned = scopedCachePinsFromM2oParents(
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
		const pinned = scopedCachePinsFromM2oParents(
			schema,
			'owned_sub_item',
			subItemFieldMap,
			[{ id: 1, label: 'a', owned_item: { id: 10, owner: { id: 100 } } }],
		);

		expect(pinned.has('owned_sub_item')).toBe(false);
	});

	it('keeps a collection reached across a to-many hop bare', () => {
		// An INSERT into `owned_item` creates a row this read would have listed, and
		// no key pin covers a key that did not exist when the entry was filled.
		const pinned = scopedCachePinsFromM2oParents(
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
		const pinned = scopedCachePinsFromM2oParents(
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
		const pinned = scopedCachePinsFromM2oParents(
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

	it('keeps a collection bare when the read nested no row of it', () => {
		// A relation the query only filtered or sorted on reaches the field map but
		// never the payload. Pinning nothing there would list the collection by
		// nothing at all, and no write to it would ever drop the read.
		expect(
			scopedCachePinsFromM2oParents(
				schema,
				'owned_sub_item',
				fieldMapOf(['owned_item', 'owned_item']),
				[{ id: 1, owned_item: null }],
			).has('owned_item'),
		).toBe(false);
	});

	it('falls back to bare when a parent row carries no key', () => {
		// Half a key set pins half the rows and silently serves the rest stale.
		const pinned = scopedCachePinsFromM2oParents(
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

		const pinned = scopedCachePinsFromM2oParents(
			a2oSchema,
			'note',
			fieldMapOf(['subject:owner', 'owner']),
			[{ id: 1, 'subject:owner': { id: 100 } }],
		);

		expect(pinned.has('owner')).toBe(false);
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
			scopedCachePinsFromM2oParents(
				selfSchema,
				'owned_item',
				fieldMapOf(['parent', 'owned_item']),
				[{ id: 1, parent: { id: 2 } }],
			).has('owned_item'),
		).toBe(false);
	});

	it('keeps a collection bare when a slot holds the raw key, not a row', () => {
		// Nothing merged a parent in, so the response cannot answer the path and the
		// walk refuses to read a key off a number.
		expect(
			scopedCachePinsFromM2oParents(
				schema,
				'owned_sub_item',
				fieldMapOf(['owned_item', 'owned_item']),
				[{ id: 1, owned_item: 10 }],
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

			const pinned = scopedCachePinsFromM2oParents(
				slicedSchema,
				'owned_item',
				ownerFieldMap,
				records,
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
				scopedCachePinsFromM2oParents(
					slicedSchema,
					'owned_item',
					ownerFieldMap,
					records.map((record, index) => {
						return { ...record, owner: { id: index, space: `s${index}` } };
					}),
				).has('owner'),
			).toBe(false);
		});

		it('reads only the direct columns of a dotted scope field', () => {
			// `owner.name` names a column on another collection, which the parent row
			// does not carry — reading it off the row would pin a wrong value.
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
				scopedCachePinsFromM2oParents(
					dottedSchema,
					'owned_item',
					ownerFieldMap,
					records,
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
			const pinned = scopedCachePinsFromM2oParents(
				schema,
				'owned_item',
				ownerFieldMap,
				records,
			);

			expect(pinned.has('owner')).toBe(false);
		});

		it('still pins the same set exactly at the ceiling', () => {
			// Non-vacuity: the two cases above degrade because of the COUNT, not
			// because this shape was never pinnable.
			const pinned = scopedCachePinsFromM2oParents(
				schema,
				'owned_item',
				ownerFieldMap,
				records.slice(0, ceiling),
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
	function astOf(
		query: Query,
		ownerNode: Partial<M2ONode> = {},
		cases: Filter[] = [],
	): AST {
		return {
			type: 'root',
			name: 'owned_item',
			query,
			cases,
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
		// `scopedCachePinsFromKeyedFilters` pins; nothing forces bare.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({ filter: { owner: { id: { _eq: 7 } } } }),
			),
		]).not.toContain('owner');
	});

	it('names a collection whose scoped fk the filter bounds to no key', () => {
		// The owner's `company` column is a scoped field, but `_neq 3` names no
		// value of it: a write moving an owner's company to 4 puts its item INTO
		// the filtered set while emitting slices this read never pinned.
		const slicedSchema = new SchemaBuilder()
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

		slicedSchema.collections['owner']!.scopedCacheFields = ['company'];

		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				slicedSchema,
				astOf({ filter: { owner: { company: { id: { _neq: 3 } } } } }),
			),
		]).toContain('owner');

		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				slicedSchema,
				astOf({ filter: { owner: { company: { id: { _eq: 3 } } } } }),
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

	it('a sorted independent collection crosses despite a covering slice', () => {
		// An `independent` collection is skipped in readFingerprints (no slice
		// pin), so its scope fields don't catch the reorder — the sort needs the
		// bare pin.
		const slicedSchema = new SchemaBuilder()
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

		slicedSchema.collections['owner']!.scopedCacheFields = ['name'];

		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				slicedSchema,
				astOf({
					filter: { owner: { id: { _eq: 7 } } },
					sort: ['owner.name'],
				}),
			),
		].sort()).toEqual(['owned_item', 'owner']);
	});

	it('a group crosses a scope-sliced filter-keyed collection even so', () => {
		// A group collapses rows across slices, so the covering slice cannot stand
		// in the way it does for a sort — it falls back to the bare pin.
		const slicedSchema = new SchemaBuilder()
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

		slicedSchema.collections['owner']!.scopedCacheFields = ['name'];

		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				slicedSchema,
				astOf({
					filter: { owner: { id: { _eq: 7 } } },
					group: ['owner.name'],
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

	it('names a collection whose nested node reads under only some cases', () => {
		// The case it does not name withholds the field for that case's rows, and
		// `mergeWithParentItems` writes those slots null like any hidden parent.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({}, { whenCase: [0] }, [
					{ name: { _eq: 'alice' } },
					{ name: { _eq: 'bob' } },
				]),
			),
		]).toContain('owner');
	});

	it('names a collection whose nested node names no case at all', () => {
		// `whenCase` points into a case list the parent does not carry, so
		// nothing here says the field survives and the bare pin stays.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({}, { whenCase: [0] }),
			),
		]).toContain('owner');
	});

	it(oneLine`
		spares a partially-cased node the caller exempts, since the case is decided
		on the row carrying the fk
	`, () => {
		const partial = astOf({}, { whenCase: [0] }, [
			{ name: { _eq: 'alice' } },
			{ name: { _eq: 'bob' } },
		]);

		expect([...scopedCacheCollectionsBeyondNestedRows(
			schema,
			partial,
			scopedCacheFilterKeyingByCollection(schema, partial),
			new Set(['owner']),
		)]).not.toContain('owner');
	});

	it(oneLine`
		names an exempted collection all the same when a filter hops through it —
		the exemption waives the case gating, not the rows the filter reads
	`, () => {
		const filtered = astOf(
			{ filter: { owner: { name: { _eq: 'alice' } } } },
			{ whenCase: [0] },
			[{ name: { _eq: 'alice' } }, { name: { _eq: 'bob' } }],
		);

		expect([...scopedCacheCollectionsBeyondNestedRows(
			schema,
			filtered,
			scopedCacheFilterKeyingByCollection(schema, filtered),
			new Set(['owner']),
		)]).toContain('owner');
	});

	it('spares a collection whose nested node reads under every case', () => {
		// A row comes back only when it matched a case and the field reads under
		// all of them, so its slot is null exactly when the foreign key is.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({}, { whenCase: [0] }, [{ name: { _eq: 'alice' } }]),
			),
		]).not.toContain('owner');
	});

	it('spares a nested node reading under every case two hops down', () => {
		// The grandchild's `whenCase` indexes the CHILD's cases, not the root's.
		expect([
			...scopedCacheCollectionsBeyondNestedRows(
				schema,
				astOf({}, {
					children: [{ ...companyNode, whenCase: [0] }],
					cases: [{ name: { _eq: 'alice' } }],
				}),
			),
		]).not.toContain('company');
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

	it('names a collection a to-many node\'s own filter reads through', () => {
		// The node's filter withholds courses; which ones is decided by teacher
		// rows the response nested only in part.
		expect([...scopedCacheCollectionsBeyondNestedRows(
			schema,
			astOf({}, {
				children: [{
					type: 'o2m',
					name: 'owner',
					fieldKey: 'owners',
					children: [companyNode],
					query: { filter: { company: { name: { _eq: 'acme' } } } },
					cases: [],
					whenCase: [],
					relation: { collection: 'owner', field: 'company' },
				} as unknown as O2MNode],
			}),
		)]).toContain('company');
	});

	it('names a collection an A2O node\'s own filter reads through', () => {
		expect([...scopedCacheCollectionsBeyondNestedRows(
			schema,
			astOf({}, {
				children: [{
					type: 'a2o',
					names: ['owner'],
					fieldKey: 'subject',
					children: { owner: [] },
					query: { owner: { filter: { company: { name: { _eq: 'acme' } } } } },
					cases: { owner: [] },
					whenCase: [],
					relation: {},
				} as unknown as A2MNode],
			}),
		)]).toContain('company');
	});

	it('names a collection a function field\'s own filter reads through', () => {
		expect([...scopedCacheCollectionsBeyondNestedRows(
			schema,
			astOf({}, {
				children: [{
					type: 'functionField',
					name: 'count(owned_items)',
					fieldKey: 'count(owned_items)',
					relatedCollection: 'owned_item',
					query: { filter: { owner: { name: { _eq: 'alice' } } } },
					cases: [],
					whenCase: [],
				} as unknown as FunctionFieldNode],
			}),
		)]).toContain('owner');
	});

	describe('a to-many node', () => {
		const toManySchema = () => {
			const built = new SchemaBuilder()
				.collection('student', (c) => {
					c.field('id').id();
					c.field('courses').o2m('course', 'student');
				})
				.collection('teacher', (c) => {
					c.field('id').id();
					c.field('name').string();
				})
				.collection('course', (c) => {
					c.field('id').id();
					c.field('title').string();
					c.field('student').m2o('student');
					c.field('teacher').m2o('teacher');
					c.field('parts').o2m('part', 'course');
				})
				.collection('part', (c) => {
					c.field('id').id();
					c.field('note').string();
					c.field('course').m2o('course');
				})
				.build();

			built.collections['course']!.scopedCacheFields = ['student'];
			built.collections['part']!.scopedCacheFields = ['course'];

			return built;
		};

		const teacherNode = {
			type: 'm2o',
			name: 'teacher',
			fieldKey: 'teacher',
			children: [],
			query: {},
			cases: [],
			whenCase: [],
			relation: { related_collection: 'teacher' },
		} as unknown as M2ONode;

		const studentReading = (
			coursesNode: Partial<O2MNode>,
			cases: Filter[] = [],
		): AST => {
			return {
				type: 'root',
				name: 'student',
				query: {},
				cases,
				children: [
					{
						type: 'o2m',
						name: 'course',
						fieldKey: 'courses',
						children: [],
						query: {},
						cases: [],
						whenCase: [],
						relation: {
							collection: 'course',
							field: 'student',
							related_collection: 'student',
						},
						...coursesNode,
					} as O2MNode,
				],
			} as AST;
		};

		it('names a collection its filter reads through a parent', () => {
			// Renaming a teacher this read never nested moves its course INTO the
			// filtered set; the parent-key pin on courses catches no teacher write.
			expect([...scopedCacheCollectionsBeyondNestedRows(
				toManySchema(),
				studentReading({
					children: [teacherNode],
					query: { filter: { teacher: { name: { _eq: 'alpha' } } } },
				}),
			)]).toContain('teacher');
		});

		it('names a collection its filter reads through its own children', () => {
			expect([...scopedCacheCollectionsBeyondNestedRows(
				toManySchema(),
				studentReading({
					query: { filter: { parts: { note: { _eq: 'x' } } } },
				}),
			)]).toContain('part');
		});

		it('names a collection it sorts on', () => {
			expect([...scopedCacheCollectionsBeyondNestedRows(
				toManySchema(),
				studentReading({
					children: [teacherNode],
					query: { sort: ['teacher.name'], limit: 1 },
				}),
			)]).toContain('teacher');
		});

		it(oneLine`
			spares itself when its own columns decide and its parent's key pins it
		`, () => {
			// Every write to a course of the student emits `course:student=<id>`,
			// the pin `scopedCachePinsFromO2mChildren` puts on this read.
			expect([...scopedCacheCollectionsBeyondNestedRows(
				toManySchema(),
				studentReading({
					query: { filter: { title: { _eq: 'shown' } }, sort: ['title'] },
				}),
			)]).not.toContain('course');
		});

		it('names itself when its own columns decide and nothing pins it', () => {
			const unpinnable = toManySchema();

			unpinnable.collections['course']!.scopedCacheFields = [];

			expect([...scopedCacheCollectionsBeyondNestedRows(
				unpinnable,
				studentReading({
					query: { filter: { title: { _eq: 'shown' } } },
				}),
			)]).toContain('course');
		});

		it('names a parent nested under it that reads under some cases only', () => {
			expect([...scopedCacheCollectionsBeyondNestedRows(
				toManySchema(),
				studentReading({
					children: [{ ...teacherNode, whenCase: [0] }],
					cases: [{ title: { _eq: 'shown' } }, { title: { _eq: 'hidden' } }],
				}),
			)]).toContain('teacher');
		});

		it('leaves what it only projects', () => {
			// Non-vacuity: walking the node is not what names its collections.
			expect([...scopedCacheCollectionsBeyondNestedRows(
				toManySchema(),
				studentReading({ children: [teacherNode] }),
			)]).toEqual([]);
		});
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

	it(oneLine`
		bares a related collection two keyable fields name at once, since one alias
		is one row and two axes name no single slice
	`, () => {
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

		// Both bound: `id` names the row and `name` names its slice. Pinning either
		// alone would claim a bound the other does not share, so the alias falls
		// bare — an over-purge, and the reason a filter written to defeat the
		// `independent` verdict has to pick a sibling the keying cannot key on.
		expect(scopedCacheFilterKeyingByCollection(scopedSchema, {
			type: 'root',
			name: 'owned_item',
			query: {
				filter: { owner: { id: { _eq: 7 }, name: { _eq: 'alice' } } },
			},
			cases: [],
			children: [],
		} as AST).get('owner')).toEqual({ kind: 'unkeyed' });
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
		// nothing joins nothing, and must not reach the response's pin header.
		expect([...keyingOf({
			filter: { categories: { 'category_id:nonexistent': { id: { _eq: 7 } } } },
		}).keys()].sort()).toEqual(['owned_item', 'owned_item_category_junction']);
	});

	it('leaves a key unkeyed when its type cannot be pinned', () => {
		// A date-like key is not safe to slice on, so even the primary key under
		// `_eq` reports unkeyed and the collection keeps its bare pin.
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
		leaves the collection hopped THROUGH unkeyed when the far key names no row,
		even with its fk a scoped field
	`, () => {
		// `_neq 3` bounds the owner's `company` column to nothing: a write moving it
		// to 4 emits `owner:company=3` and `owner:company=4`, neither of which a
		// read keyed on an empty set holds. Only the bare pin reaches it.
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

		for (const operators of [
			{ _neq: 3 },
			{ _gt: 3 },
			{ _nnull: true },
			{ _nin: [3] },
			{ _in: [] },
		]) {
			const keying = scopedCacheFilterKeyingByCollection(scopedSchema, {
				type: 'root',
				name: 'owned_item',
				query: { filter: { owner: { company: { id: operators } } } },
				cases: [],
				children: [],
			} as AST);

			expect(keying.get('owner'), JSON.stringify(operators))
				.toEqual({ kind: 'unkeyed' });

			expect(keying.get('company'), JSON.stringify(operators))
				.toEqual({ kind: 'independent', field: 'id', keys: new Set() });
		}
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

describe('scopedCachePinsFromO2mChildren', () => {
	// `child` hangs off `parent` twice, over two different fks, so one read can
	// reach it by two names. `grandchild` sits a second to-many hop down, and
	// `root` reaches the parent through an M2O so a prefix has something to walk.
	const schema = new SchemaBuilder()
		.collection('parent', (c) => {
			c.field('id').id();
			c.field('name').string();
			c.field('children').o2m('child', 'parent');
			c.field('alt_children').o2m('child', 'alt_parent');
			c.field('drafts').o2m('child', 'drafted_by');
			c.field('favorite').m2o('child');
		})
		.collection('child', (c) => {
			c.field('id').id();
			c.field('body').string();
			c.field('parent').m2o('parent');
			c.field('alt_parent').m2o('parent');
			c.field('drafted_by').m2o('parent');
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

	// The pin only applies where the write side emits the matching shallow pin,
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
	) {
		return scopedCachePinsFromO2mChildren(
			schema,
			rootCollection,
			fieldMap,
			records,
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
		// collection to the bare pin rather than a partial pin.
		expect(pinnedFor(
			'parent',
			fieldMapOf(['children', 'child']),
			[{ id: 1, name: 'a' }, { name: 'no key' }],
		).has('child')).toBe(false);
	});

	it('reports a two-fk-conflicted child in conflictedOut', () => {
		// The signal the ancestor-slice reads to keep this child bare: no single
		// ownership slice covers rows reached by two disagreeing reverse fks.
		const conflicted = new Set<CollectionKey>();

		scopedCachePinsFromO2mChildren(
			schema,
			'parent',
			fieldMapOf(['children', 'child'], ['alt_children', 'child']),
			[{ id: 1, name: 'a' }],
			conflicted,
		);

		expect([...conflicted]).toEqual(['child']);
	});

	it(oneLine`
		reports a child one path reaches through an M2O in conflictedOut — those rows
		lie outside every parent-key slice, and the M2O pinner declined the mix
	`, () => {
		const conflicted = new Set<CollectionKey>();

		const pinned = scopedCachePinsFromO2mChildren(
			schema,
			'parent',
			fieldMapOf(['children', 'child'], ['favorite', 'child']),
			[{ id: 1, name: 'a', favorite: { id: 9 } }],
			conflicted,
		);

		expect(pinned.has('child')).toBe(false);
		expect([...conflicted]).toEqual(['child']);
	});

	it(oneLine`
		reports a child one path reaches through an o2m whose reverse fk is not
		scoped — that path's rows carry no slice a write would emit
	`, () => {
		const conflicted = new Set<CollectionKey>();

		const pinned = scopedCachePinsFromO2mChildren(
			schema,
			'parent',
			fieldMapOf(['children', 'child'], ['drafts', 'child']),
			[{ id: 1, name: 'a' }],
			conflicted,
		);

		expect(pinned.has('child')).toBe(false);
		expect([...conflicted]).toEqual(['child']);
	});

	it('leaves conflictedOut empty for a child keyed on one fk', () => {
		const conflicted = new Set<CollectionKey>();

		scopedCachePinsFromO2mChildren(
			schema,
			'parent',
			fieldMapOf(['children', 'child']),
			[{ id: 1, name: 'a' }],
			conflicted,
		);

		expect([...conflicted]).toEqual([]);
	});

	it('leaves the root collection alone', () => {
		expect(pinnedFor(
			'parent',
			fieldMapOf(['', 'parent']),
			[{ id: 1, name: 'a' }],
		).has('parent')).toBe(false);
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

describe('scopedCachePathReversesChain', () => {
	// user <- student.user <- course.student: a user read nesting `students.courses`
	// walks the course's `student.user` chain backwards. `reviews` reaches course
	// through a second fk the chain never names.
	const schema = new SchemaBuilder()
		.collection('user', (c) => {
			c.field('id').id();
			c.field('students').o2m('student', 'user');
			c.field('reviews').o2m('course', 'reviewer');
		})
		.collection('student', (c) => {
			c.field('id').id();
			c.field('user').m2o('user');
			c.field('courses').o2m('course', 'student');
		})
		.collection('course', (c) => {
			c.field('id').id();
			c.field('student').m2o('student');
			c.field('reviewer').m2o('user');
		})
		.build();

	it('accepts the o2m walk back down a chain, hop for hop', () => {
		expect(scopedCachePathReversesChain(
			schema,
			'user',
			['students', 'courses'],
			'course',
			['student', 'user'],
		)).toBe(true);

		expect(scopedCachePathReversesChain(
			schema,
			'student',
			['courses'],
			'course',
			['student'],
		)).toBe(true);
	});

	it('refuses a path reaching the collection through another fk', () => {
		expect(scopedCachePathReversesChain(
			schema,
			'user',
			['reviews'],
			'course',
			['student', 'user'],
		)).toBe(false);

		expect(scopedCachePathReversesChain(
			schema,
			'user',
			['reviews'],
			'course',
			['reviewer'],
		)).toBe(true);
	});

	it(oneLine`
		refuses a chain that does not end on the root, or a path of another length
	`, () => {
		expect(scopedCachePathReversesChain(
			schema,
			'user',
			['students', 'courses'],
			'course',
			['student'],
		)).toBe(false);

		expect(scopedCachePathReversesChain(
			schema,
			'user',
			['students'],
			'course',
			['student', 'user'],
		)).toBe(false);

		expect(scopedCachePathReversesChain(
			schema,
			'user',
			['students', 'courses'],
			'course',
			['id'],
		)).toBe(false);
	});
});

describe('scopedCachePinsFromKeyedFilters', () => {
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
		return scopedCachePinsFromKeyedFilters(schema, 'owned_item', keying);
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
			field: 'id',
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


describe('the purge counters a fill is guarded by', () => {
	// Two merge rules, and they are not the same rule. A read's own value was read
	// before its query, so it is earlier than anything a hook can hand over and wins
	// without a comparison. Two readings that become ONE entry have no such
	// ordering, so the earlier one has to be found.
	it(oneLine`
		keeps the read's own reading over a counter a hook handed for the same
		collection
	`, () => {
		expect(foldScopedCacheEpochsFromHookDeclarations(
			{ articles: '7', '*': '1' },
			{ articles: '9', authors: '4' },
		)).toEqual({ articles: '7', '*': '1', authors: '4' });
	});

	it(oneLine`
		takes a declared counter for a collection the before-query reading never
		named, since that is the only reading of it there is
	`, () => {
		expect(foldScopedCacheEpochsFromHookDeclarations({}, { authors: '4' }))
			.toEqual({ authors: '4' });
	});

	it('keeps a declared null, which is the earliest reading there is', () => {
		expect(foldScopedCacheEpochsFromHookDeclarations({}, { authors: null }))
			.toEqual({ authors: null });
	});

	it(oneLine`
		merges two readings of one entry down to the EARLIER one, so a purge between
		them is still visible at fill time
	`, () => {
		const merged = { articles: '9', authors: '2' };
		mergeScopedCacheEpochs(merged, { articles: '7', tags: '5' });

		expect(merged).toEqual({ articles: '7', authors: '2', tags: '5' });
	});

	it(oneLine`
		folds the readings one response carries into one, or none when it carries
		none — an empty reading is a guard that ran, undefined is one that did not
	`, () => {
		expect(mergedScopedCacheEpochs(undefined, undefined)).toBeUndefined();
		expect(mergedScopedCacheEpochs({}, undefined)).toEqual({});

		expect(mergedScopedCacheEpochs(
			{ articles: '7', '*': '1' },
			{ articles: '9', authors: '4', '*': '1' },
		)).toEqual({ articles: '7', authors: '4', '*': '1' });
	});

	it('names the scoped collections no reading covered', () => {
		expect(scopedCacheCollectionsWithoutGuard(
			{ articles: '7', '*': '1' },
			[
				scopedCacheFingerprintOf('articles', []),
				scopedCacheFingerprintOf('authors', []),
			],
		)).toEqual(['authors']);
	});

	// `*` rides every reading, so its absence says the counters were never read —
	// with nothing guarded either way, refusing here would take the whole cache down.
	it('names nothing when the counters were never read', () => {
		expect(scopedCacheCollectionsWithoutGuard(
			{},
			[scopedCacheFingerprintOf('authors', [])],
		)).toEqual([]);

		expect(scopedCacheCollectionsWithoutGuard(
			undefined,
			[scopedCacheFingerprintOf('authors', [])],
		)).toEqual([]);
	});
});

// The counters themselves, as opposed to the merge rules above: what a read asks
// Redis for before its query, and what it answers when it cannot ask. Every arm
// below is a failure or a configuration one, so none of them can be covered in
// blackbox — a read that reads nothing looks exactly like one that found nothing
// moved.
describe('reading and bumping the purge counters', () => {
	const mget = vi.fn();

	const counterPipeline = {
		incr: vi.fn().mockReturnThis(),
		expire: vi.fn().mockReturnThis(),
		exec: vi.fn(),
	};

	beforeEach(() => {
		env['CACHE_ENABLED'] = true;
		mget.mockResolvedValue([]);
		counterPipeline.exec.mockResolvedValue([]);

		vi.mocked(useRedis).mockReturnValue({
			mget,
			pipeline: () => counterPipeline,
		} as any);
	});

	afterEach(() => {
		delete env['CACHE_ENABLED'];
		delete env['CACHE_SCOPED_EPOCH_TTL'];
	});

	it('asks for the wholesale counter alongside the named collections', async () => {
		mget.mockResolvedValue(['7', '1']);

		expect(await readScopedCacheEpochs(['articles'])).toEqual({
			articles: '7',
			'*': '1',
		});

		expect(mget).toHaveBeenCalledWith([
			'ns:scoped-cache-epoch:articles',
			'ns:scoped-cache-epoch:*',
		]);
	});

	it('asks once for a collection named twice', async () => {
		await readScopedCacheEpochs(['articles', 'articles']);

		expect(mget).toHaveBeenCalledWith([
			'ns:scoped-cache-epoch:articles',
			'ns:scoped-cache-epoch:*',
		]);
	});

	// Every read pays this round trip, so it is skipped wherever its answer could
	// not matter. Nothing is filled with the response cache off.
	it.each([
		['the response cache is off', () => {
			env['CACHE_ENABLED'] = false;
		}],
		['scoped purging is off', () => {
			env['CACHE_AUTO_PURGE_MODE'] = 'full';
		}],
		['there is no Redis configured', () => {
			vi.mocked(redisConfigAvailable).mockReturnValue(false);
		}],
	])('reads nothing, and asks nothing, when %s', async (_case, disable) => {
		disable();

		expect(await readScopedCacheEpochs(['articles'])).toEqual({});
		expect(mget).not.toHaveBeenCalled();
	});

	// A read that cannot reach the counters still has to answer, and the fill is
	// left unguarded exactly as it is with no Redis at all. What it must NOT do is
	// answer with a counter reading per collection: `*` is what says the counters
	// were read at all, so filling it in from a read that never happened reports the
	// guard as covering collections nothing was read for.
	it(oneLine`
		reads nothing at all when the counters cannot be read, rather than a reading
		of null per collection
	`, async () => {
		mget.mockRejectedValue(new Error('connection is closed'));

		const epochsBeforeQuery = await readScopedCacheEpochs(['articles']);

		expect(epochsBeforeQuery).toEqual({});

		// The read names a collection the reading never covered, and with no `*` the
		// guard reports itself off rather than claiming to have covered it.
		expect(scopedCacheCollectionsWithoutGuard(epochsBeforeQuery, [
			scopedCacheFingerprintOf('articles', []),
		])).toEqual([]);
	});

	// `exec` rejects only on a connection-level failure, so an INCR refused on its
	// own resolves as an entry error. Nothing here can stop the sweep behind it —
	// that is what makes the cache correct — but a guard that silently stopped
	// guarding must not also be silent: the fills racing this purge are unguarded.
	it('warns when a counter bump was refused rather than dropped', async () => {
		const warn = vi.fn();
		vi.mocked(useLogger).mockReturnValue({ info: vi.fn(), warn } as any);

		counterPipeline.exec.mockResolvedValue([
			[null, 1],
			[new Error('OOM command not allowed'), null],
		]);

		await bumpScopedCacheEpochs(['articles']);

		expect(warn).toHaveBeenCalledOnce();
	});

	it('says nothing when every bump landed', async () => {
		const warn = vi.fn();
		vi.mocked(useLogger).mockReturnValue({ info: vi.fn(), warn } as any);

		counterPipeline.exec.mockResolvedValue([[null, 1], [null, 1]]);

		await bumpScopedCacheEpochs(['articles']);

		expect(warn).not.toHaveBeenCalled();
	});

	// An expiring counter, so a collection nothing writes to stops costing a key. A
	// read whose counter expired between the two readings reads null on both sides
	// and caches, which is right — nothing purged it in between.
	it(oneLine`
		bumps each collection once and gives the counter a day by default
	`, async () => {
		await bumpScopedCacheEpochs(['articles', 'articles', 'authors']);

		expect(counterPipeline.incr).toHaveBeenCalledTimes(2);

		expect(counterPipeline.incr)
			.toHaveBeenCalledWith('ns:scoped-cache-epoch:articles');

		expect(counterPipeline.incr)
			.toHaveBeenCalledWith('ns:scoped-cache-epoch:authors');

		expect(counterPipeline.expire)
			.toHaveBeenCalledWith('ns:scoped-cache-epoch:articles', 24 * 60 * 60);

		expect(counterPipeline.exec).toHaveBeenCalledOnce();
	});

	it('holds the counter for the configured duration', async () => {
		env['CACHE_SCOPED_EPOCH_TTL'] = '2h';

		await bumpScopedCacheEpochs(['articles']);

		expect(counterPipeline.expire)
			.toHaveBeenCalledWith('ns:scoped-cache-epoch:articles', 2 * 60 * 60);
	});

	// ms() parses neither, and expiring the counter on the command that bumps it
	// would leave every fill racing that purge unguarded.
	it('falls back to a day on a duration Redis could not be given', async () => {
		env['CACHE_SCOPED_EPOCH_TTL'] = 'whenever';

		await bumpScopedCacheEpochs(['articles']);

		expect(counterPipeline.expire)
			.toHaveBeenCalledWith('ns:scoped-cache-epoch:articles', 24 * 60 * 60);
	});

	it('opens no pipeline for an empty collection list', async () => {
		await bumpScopedCacheEpochs([]);

		expect(counterPipeline.exec).not.toHaveBeenCalled();
	});

	// Best effort, and the whole of it: this runs BEFORE the sweep, so letting a
	// client that cannot take the command through would abort the purge itself —
	// trading every entry it was about to drop for the one racing fill the counter
	// would have refused.
	it(oneLine`
		swallows a bump the client refuses, so the sweep behind it still runs
	`, async () => {
		counterPipeline.exec.mockRejectedValue(new Error('closed'));

		await expect(bumpScopedCacheEpochs(['articles'])).resolves.toBeUndefined();
	});

	// Called AFTER the entry is written: a purge bumps the counters before it
	// sweeps, so re-reading them here catches every interleaving the pre-fill check
	// was too early to see.
	it('names the collection whose counter moved during the fill', async () => {
		mget.mockResolvedValue(['8', '1']);

		expect(await scopedCacheSweptDuringFill({ articles: '7', '*': '1' }))
			.toBe('articles');
	});

	it('names the wholesale counter when a flush moved that one', async () => {
		mget.mockResolvedValue(['7', '2']);

		expect(await scopedCacheSweptDuringFill({ articles: '7', '*': '1' }))
			.toBe('*');
	});

	it('names nothing when every counter reads back the same', async () => {
		mget.mockResolvedValue(['7', '1']);

		expect(await scopedCacheSweptDuringFill({ articles: '7', '*': '1' }))
			.toBeUndefined();
	});

	// A counter that vanished between the two reads moved, and so did one that
	// appeared: either way the entry cannot be trusted.
	it('names a counter that stopped answering as moved', async () => {
		mget.mockResolvedValue([null, '1']);

		expect(await scopedCacheSweptDuringFill({ articles: '7', '*': '1' }))
			.toBe('articles');
	});
});

// Absent beats every count: a counter that did not exist yet is the earliest
// reading there is, and any number later on proves a purge created it in between.
describe('the earlier of two counter readings', () => {
	it('takes the lower count', () => {
		expect(earlierScopedCacheEpoch('7', '9')).toBe('7');
		expect(earlierScopedCacheEpoch('9', '7')).toBe('7');
	});

	it('keeps the reading when both agree', () => {
		expect(earlierScopedCacheEpoch('7', '7')).toBe('7');
	});

	it.each([
		['a missing left', null, '9'],
		['a missing right', '7', null],
		['an absent left', undefined, '9'],
	])('answers absent for %s', (_case, left, right) => {
		expect(earlierScopedCacheEpoch(left, right)).toBeNull();
	});

	// `INCR` cannot produce one, so a value that will not parse means something is
	// wrong, and the direction that fails toward not caching is the one to take.
	it('answers absent for a reading no INCR could have written', () => {
		expect(earlierScopedCacheEpoch('7', 'not-a-count')).toBeNull();
	});
});

// Scoped purging drives SCAN + multi-key DEL over a single node, so a cluster
// client would silently under-purge — keys on other nodes are never scanned — and
// leave stale slices. `useRedis()` always builds a standalone client in core, so
// this only bites a custom override, and there is no blackbox rig that supplies one.
describe('the Redis client scoped purging requires', () => {
	it('refuses a cluster client while scoped purging is on', () => {
		vi.mocked(useRedis).mockReturnValue({ isCluster: true } as any);

		expect(() => assertScopedCacheStoreSupported())
			.toThrow(/not implemented for Redis cluster/);
	});

	it('accepts a standalone client', () => {
		vi.mocked(useRedis).mockReturnValue({ isCluster: false } as any);

		expect(() => assertScopedCacheStoreSupported()).not.toThrow();
	});

	// Outside scoped mode the purge is a full flush, which a cluster takes.
	it('says nothing about a cluster with scoped purging off', () => {
		env['CACHE_AUTO_PURGE_MODE'] = 'full';
		vi.mocked(useRedis).mockReturnValue({ isCluster: true } as any);

		expect(() => assertScopedCacheStoreSupported()).not.toThrow();
	});
});

// The read gets a scope value parsed out of a filter and the write reads it back off
// the driver, so the two shapes have to canonicalise to ONE token or the read pins a
// key no write emits. The types below are the ones where those shapes differ; the
// blackbox suite drives the ones a filter can express, and these are the rest.
describe('the canonical scope value', () => {
	// A uuid is compared case-insensitively by the database, so both spellings name
	// one row and must name one slice. Neither side normalises for us.
	it('folds a uuid to one case', () => {
		const upper = '3F2504E0-4F89-11D3-9A0C-0305E82C3301';

		expect(canonicalizeScopedCachePinValue(upper, 'uuid'))
			.toBe(upper.toLowerCase());
	});

	// Every spelling a boolean column accepts is one value to the database, so they
	// must be one slice: unfolded, a read filtered `flag=TRUE` pins `flag=false`
	// while the write emits `flag=true`, and no purge ever reaches that entry.
	it.each([
		true, 1, '1', 't', 'T', 'true', 'TRUE', 'True', 'y', 'YES', 'on', 'ON',
	])('reads %s as the one true slice', (raw) => {
		expect(canonicalizeScopedCachePinValue(raw, 'boolean')).toBe('true');
	});

	it.each([
		false, 0, '0', 'f', 'F', 'false', 'FALSE', 'n', 'NO', 'off',
	])('reads %s as the one false slice', (raw) => {
		expect(canonicalizeScopedCachePinValue(raw, 'boolean')).toBe('false');
	});

	it('reads null and undefined as the one sentinel', () => {
		expect(canonicalizeScopedCachePinValue(null, 'string')).toBe('\x00null');
		expect(canonicalizeScopedCachePinValue(undefined, 'string')).toBe('\x00null');
	});

	// `01`, `+1`, `0001` and a driver's `1` are one key to the database, so they
	// must not resolve different slices.
	it.each([
		['0042', '42'],
		['+42', '42'],
		['0', '0'],
		['-0', '0'],
		['-0042', '-42'],
	])('strips an integer spelling %s down to %s', (raw, canonical) => {
		expect(canonicalizeScopedCachePinValue(raw, 'bigInteger')).toBe(canonical);
	});

	// Spellings `validateKeys` still lets through, since it only asks
	// `Number.isInteger(Number(key))`.
	it.each([
		['1e3', '1000'],
		['0x10', '16'],
		['1.0', '1'],
	])('normalises %s, which validateKeys accepts, to %s', (raw, canonical) => {
		expect(canonicalizeScopedCachePinValue(raw, 'integer')).toBe(canonical);
	});

	// Past MAX_SAFE_INTEGER no token can be right, and such a key cannot have
	// matched a row either, so a numeric pass would corrupt it for nothing.
	it('keeps an unsafe integer spelling exactly as written', () => {
		expect(canonicalizeScopedCachePinValue('9007199254740993e0', 'bigInteger'))
			.toBe('9007199254740993e0');
	});

	it('keeps a bigInteger magnitude no Number could hold', () => {
		const beyond = '170141183460469231731687303715884105727';

		expect(canonicalizeScopedCachePinValue(`0${beyond}`, 'bigInteger')).toBe(beyond);
	});

	// Only the fixed-scale types need the numeric pass (`'1.50'` vs `1.5`).
	it.each(['decimal', 'float'] as const)('reads a %s numerically', (type) => {
		expect(canonicalizeScopedCachePinValue('1.50', type)).toBe('1.5');
		expect(canonicalizeScopedCachePinValue(1.5, type)).toBe('1.5');
	});

	it('keeps a decimal that is not a number as written', () => {
		expect(canonicalizeScopedCachePinValue('not-a-number', 'decimal'))
			.toBe('not-a-number');
	});

	// `time` has no date component, so both sides give `HH:MM:SS` and it stays a
	// plain string — unlike the three types below it.
	it('leaves a time value alone', () => {
		expect(canonicalizeScopedCachePinValue('05:06:07', 'time')).toBe('05:06:07');
	});

	it.each(['date', 'dateTime', 'timestamp'] as const)(
		'reads a %s as epoch milliseconds',
		(type) => {
			const iso = '2024-03-04T05:06:07.000Z';

			expect(canonicalizeScopedCachePinValue(iso, type))
				.toBe(String(Date.parse(iso)));

			expect(canonicalizeScopedCachePinValue(new Date(iso), type))
				.toBe(String(Date.parse(iso)));
		},
	);

	it('keeps a date it cannot parse as written', () => {
		expect(canonicalizeScopedCachePinValue('never', 'dateTime')).toBe('never');
	});

	it('falls through to the string form for a type it says nothing about', () => {
		expect(canonicalizeScopedCachePinValue(7, 'json')).toBe('7');
		expect(canonicalizeScopedCachePinValue(7, undefined)).toBe('7');
	});

	// A naive column comes back as a local Date from the driver but as an ISO string
	// from a filter, so the epoch-ms canonical can diverge across drivers and
	// timezones. The read side never pins these — the bare collection pin instead,
	// which over-purges and cannot go stale.
	it.each(['date', 'dateTime', 'timestamp'] as const)(
		'refuses to pin a %s',
		(type) => {
			expect(isPinnableScopeType(type)).toBe(false);
		},
	);

	it.each(['string', 'uuid', 'integer', 'boolean', 'time', undefined] as const)(
		'pins a %s',
		(type) => {
			expect(isPinnableScopeType(type)).toBe(true);
		},
	);
});

// The view a fingerprint narrows to: a write rewriting none of these fields is
// taken not to change the response, so each one the read depends on has to be
// here.
describe('ScopedCacheReadPlan.fieldsByCollection', () => {
	it('names the fields a permission case filters the root by', () => {
		const schema = new SchemaBuilder()
			.collection('article', (c) => {
				c.field('id').id();
				c.field('title').string();
				c.field('status').string();
			})
			.build();

		const plan = new ScopedCacheReadPlan('article', schema, {
			type: 'root',
			name: 'article',
			query: {},
			cases: [{ status: { _eq: 'published' } }],
			children: [
				{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [] },
				{ type: 'field', name: 'title', fieldKey: 'title', whenCase: [] },
			],
		} as unknown as AST, []);

		expect(plan.fieldsByCollection()).toEqual(new Map([
			['article', ['id', 'status', 'title']],
		]));
	});

	it('names the fields a nested node\'s case filters through a relation', () => {
		const schema = new SchemaBuilder()
			.collection('author', (c) => {
				c.field('id').id();
				c.field('name').string();
				c.field('team').m2o('team');
			})
			.collection('team', (c) => {
				c.field('id').id();
				c.field('active').boolean();
			})
			.collection('article', (c) => {
				c.field('id').id();
				c.field('author').m2o('author');
			})
			.build();

		const plan = new ScopedCacheReadPlan('article', schema, {
			type: 'root',
			name: 'article',
			query: {},
			cases: [],
			children: [
				{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [] },
				{
					type: 'm2o',
					name: 'author',
					fieldKey: 'author',
					query: {},
					cases: [{ team: { active: { _eq: true } } }],
					whenCase: [],
					relation: {
						collection: 'article',
						field: 'author',
						related_collection: 'author',
					},
					children: [
						{ type: 'field', name: 'name', fieldKey: 'name', whenCase: [] },
					],
				},
			],
		} as unknown as AST, []);

		expect(plan.fieldsByCollection()).toEqual(new Map([
			['article', ['author', 'id']],
			['author', ['name', 'team']],
			['team', ['active']],
		]));
	});

	it('names every column the root\'s search can match', () => {
		const schema = new SchemaBuilder()
			.collection('article', (c) => {
				c.field('id').id();
				c.field('title').string();
				c.field('body').text();
				c.field('views').integer();
				c.field('featured').boolean();
			})
			.build();

		const plan = new ScopedCacheReadPlan('article', schema, {
			type: 'root',
			name: 'article',
			query: { search: 'news' },
			cases: [],
			children: [
				{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [] },
			],
		} as unknown as AST, []);

		expect(plan.fieldsByCollection()).toEqual(new Map([
			['article', ['body', 'id', 'title', 'views']],
		]));
	});

	it('names every column a nested node\'s deep search can match', () => {
		const schema = new SchemaBuilder()
			.collection('article', (c) => {
				c.field('id').id();
				c.field('comments').o2m('comment', 'article');
			})
			.collection('comment', (c) => {
				c.field('id').id();
				c.field('body').string();
				c.field('article').m2o('article');
			})
			.build();

		const plan = new ScopedCacheReadPlan('article', schema, {
			type: 'root',
			name: 'article',
			query: {},
			cases: [],
			children: [
				{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [] },
				{
					type: 'o2m',
					name: 'comment',
					fieldKey: 'comments',
					query: { search: 'news' },
					cases: [],
					whenCase: [],
					relation: {
						collection: 'comment',
						field: 'article',
						related_collection: 'article',
						meta: { one_field: 'comments' },
					},
					children: [
						{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [] },
					],
				},
			],
		} as unknown as AST, []);

		expect(plan.fieldsByCollection()).toEqual(new Map([
			['article', ['comments', 'id']],
			['comment', ['article', 'body', 'id']],
		]));
	});

	it('names the collection column of an A2O the read nests through', () => {
		const schema = new SchemaBuilder()
			.collection('owner', (c) => {
				c.field('id').id();
			})
			.collection('note', (c) => {
				c.field('id').id();
				c.field('subject').a2o(['owner']);
			})
			.build();

		const plan = new ScopedCacheReadPlan('note', schema, {
			type: 'root',
			name: 'note',
			query: {},
			cases: [],
			children: [
				{
					type: 'a2o',
					names: ['owner'],
					fieldKey: 'subject',
					children: {
						owner: [
							{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [] },
						],
					},
					query: { owner: {} },
					cases: { owner: [] },
					whenCase: [],
					relation: {
						collection: 'note',
						field: 'subject',
						related_collection: null,
						meta: { one_collection_field: 'collection' },
					},
				},
			],
		} as unknown as AST, []);

		expect(plan.fieldsByCollection()).toEqual(new Map([
			['note', ['collection', 'subject']],
			['owner', ['id']],
		]));
	});

	it('names the fk a count() over a permission-cased to-many reads by', () => {
		const schema = new SchemaBuilder()
			.collection('article', (c) => {
				c.field('id').id();
				c.field('comments').o2m('comment', 'article');
			})
			.collection('comment', (c) => {
				c.field('id').id();
				c.field('status').string();
				c.field('article').m2o('article');
			})
			.build();

		const plan = new ScopedCacheReadPlan('article', schema, {
			type: 'root',
			name: 'article',
			query: {},
			cases: [],
			children: [
				{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [] },
				{
					type: 'functionField',
					name: 'count(comments)',
					fieldKey: 'count(comments)',
					query: {},
					relatedCollection: 'comment',
					cases: [{ status: { _eq: 'published' } }],
					whenCase: [],
				},
			],
		} as unknown as AST, []);

		expect(plan.fieldsByCollection()).toEqual(new Map([
			['article', ['comments', 'id']],
			['comment', ['article', 'status']],
		]));
	});

	it('leaves out a collection whose binding to its parent is unknown', () => {
		const schema = new SchemaBuilder()
			.collection('article', (c) => {
				c.field('id').id();
				c.field('comments').o2m('comment', 'article');
			})
			.collection('comment', (c) => {
				c.field('id').id();
				c.field('status').string();
				c.field('article').m2o('article');
			})
			.build();

		const plan = new ScopedCacheReadPlan('article', schema, {
			type: 'root',
			name: 'article',
			query: {},
			cases: [],
			children: [
				{ type: 'field', name: 'id', fieldKey: 'id', whenCase: [] },
				{
					type: 'functionField',
					name: 'count(comments)',
					fieldKey: 'total',
					query: {},
					relatedCollection: 'comment',
					cases: [{ status: { _eq: 'published' } }],
					whenCase: [],
				},
			],
		} as unknown as AST, []);

		expect(plan.fieldsByCollection()).toEqual(new Map([
			['article', ['comments', 'id']],
		]));
	});
});
