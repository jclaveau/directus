import { oneLine } from '@directus/utils';
import type { Keyv } from 'keyv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { purgeScopedCache } from './purge.js';
import { scopedCacheFingerprintOf } from './fingerprint.js';
import { redisConfigAvailable, useRedis } from '../redis/index.js';
import { useLogger } from '../logger/index.js';
import {
	listPendingScopedCachePurges,
	recordPendingScopedCachePurge,
} from '../scoped-cache-pending-purges.js';

// hoisted: the modules under test read `const env = useEnv()` at load, before a
// plain `const env` below would be initialised (temporal dead zone).
const env = vi.hoisted(() => {
	return {
		CACHE_AUTO_PURGE_MODE: 'scoped',
		CACHE_STORE: 'redis',
		CACHE_NAMESPACE: 'ns',
		CACHE_SCOPED_MAX_PINS_PER_COLLECTION: 250,
		CACHE_SCOPED_MAX_QUERY_CASES: 16,
	} as Record<string, any>;
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('../redis/index.js');
vi.mock('../logger/index.js', () => ({ useLogger: vi.fn() }));

vi.mock('../emitter.js', () => {
	return {
		default: {
			emitAction: vi.fn(),
			emitFilter: vi.fn((_event, payload) => payload),
		},
	};
});

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

// A cache with no redis-backed store, so a drop is one `delete` per key and a case
// reads the keys it took straight off the mock.
const cache = { delete: vi.fn(), namespace: 'ns' } as unknown as Keyv;

// What each index set holds, keyed by the set a case expects the purge to read.
let members: Record<string, string[]>;

// The index prune rides the same pipeline as the counter bumps, so a case reads
// what it dropped off the pipeline's `srem` rather than off the client's.
const srem = vi.fn();
const swept: string[][] = [];

const sscan = vi.fn(async (key: string, _cursor: string) => {
	return ['0', members[key] ?? []];
});

// A purge holding no rows reads the collection's sets off the keyspace, so the
// scan answers with the sets the case declared under that collection.
const scan = vi.fn(async (_cursor: string, _match: string, pattern: string) => {
	const prefix = pattern.slice(0, -1);

	return ['0', Object.keys(members).filter((key) => key.startsWith(prefix))];
});

const evalScript = vi.fn(async (
	_script: string,
	numKeys: number,
	...args: string[]
) => {
	swept.push(args.slice(0, numKeys));
	return [];
});

beforeEach(() => {
	vi.clearAllMocks();
	members = {};
	swept.length = 0;

	vi.mocked(useLogger).mockReturnValue({ info: vi.fn(), warn: vi.fn() } as any);
	vi.mocked(listPendingScopedCachePurges).mockResolvedValue([]);
	vi.mocked(redisConfigAvailable).mockReturnValue(true);

	vi.mocked(useRedis).mockReturnValue({
		sscan,
		scan,
		eval: evalScript,
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
	} as any);
});

describe('a purge shown the rows it wrote', () => {
	it(oneLine`
		drops the entries whose whole query case the row satisfies, and leaves the one
		bound to another value of a field the row also carries
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:slot:': ['slot:&|ns:entry-bare'],
			'ns:scoped-cache-index:fingerprint:slot:owner=alpha': [
				'slot:&owner=,alpha,&|ns:entry-alpha',
				'slot:&method=,slow,&owner=,alpha,&|ns:entry-alpha-slow',
			],
		};

		// One row of `slot`, owned by alpha, whose `method` the write rewrote.
		await purgeScopedCache(cache, 'slot', [], null, {
			rowFingerprints: [{
				collection: 'slot',
				pinnedScope: { id: ['1'], method: ['spaced'], owner: ['alpha'] },
			}],
			changed: ['method'],
			indexPath: 'owner',
		});

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-bare');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-alpha');
		expect(cache.delete).not.toHaveBeenCalledWith('ns:entry-alpha-slow');
	});

	it('reads the bare set and the one its row owns, and no other', async () => {
		await purgeScopedCache(cache, 'slot', [], null, {
			rowFingerprints: [{
				collection: 'slot',
				pinnedScope: { id: ['1'], method: ['spaced'], owner: ['alpha'] },
			}],
			changed: ['method'],
			indexPath: 'owner',
		});

		expect([...new Set(sscan.mock.calls.map(([key]) => key))]).toEqual([
			'ns:scoped-cache-index:fingerprint:slot:',
			'ns:scoped-cache-index:fingerprint:slot:owner=alpha',
		]);
	});

	it(oneLine`
		keeps an entry bound to fields the update never rewrote: its response cannot
		have changed, whichever slice the row sits in
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:slot:owner=alpha': [
				'slot:&owner=,alpha,&view=,title,&|ns:entry-title',
			],
		};

		await purgeScopedCache(cache, 'slot', [], null, {
			rowFingerprints: [{
				collection: 'slot',
				pinnedScope: { id: ['1'], method: ['spaced'], owner: ['alpha'] },
			}],
			changed: ['method'],
			indexPath: 'owner',
		});

		expect(cache.delete).not.toHaveBeenCalled();
	});

	it(oneLine`
		drops that same entry for an insert or a delete, where the row entered or
		left the result set whichever columns it carries
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:slot:owner=alpha': [
				'slot:&owner=,alpha,&view=,title,&|ns:entry-title',
			],
		};

		await purgeScopedCache(cache, 'slot', [], null, {
			rowFingerprints: [{
				collection: 'slot',
				pinnedScope: { id: ['1'], method: ['spaced'], owner: ['alpha'] },
			}],
			changed: null,
			indexPath: 'owner',
		});

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-title');
	});

	it(oneLine`
		removes the matched member from the set it was found in, so a later write to
		the same index value does not test a key that is already gone
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:slot:owner=alpha': [
				'slot:&owner=,alpha,&|ns:entry-alpha',
				'slot:&method=,slow,&owner=,alpha,&|ns:entry-alpha-slow',
			],
		};

		await purgeScopedCache(cache, 'slot', [], null, {
			rowFingerprints: [{
				collection: 'slot',
				pinnedScope: { id: ['1'], method: ['spaced'], owner: ['alpha'] },
			}],
			changed: ['method'],
			indexPath: 'owner',
		});

		expect(srem).toHaveBeenCalledWith(
			'ns:scoped-cache-index:fingerprint:slot:owner=alpha',
			'slot:&owner=,alpha,&|ns:entry-alpha',
		);

		expect(srem).toHaveBeenCalledTimes(1);
	});

	it('reads a set larger than one page to its end', async () => {
		sscan.mockImplementationOnce(async () => {
			return ['7', ['slot:&|ns:entry-first']];
		});

		sscan.mockImplementationOnce(async () => {
			return ['0', ['slot:&|ns:entry-second']];
		});

		await purgeScopedCache(cache, 'slot', [], null, {
			rowFingerprints: [{
				collection: 'slot',
				pinnedScope: { id: ['1'], method: ['spaced'], owner: ['alpha'] },
			}],
			changed: ['method'],
			indexPath: null,
		});

		// One pass per pattern the rows can drop something under — the two bare ones
		// plus one per pin of the row — and the first of them takes a second page.
		expect(sscan.mock.calls.map(([, cursor]) => cursor)).toEqual([
			'0',
			'7',
			'0',
			'0',
			'0',
			'0',
		]);

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-first');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-second');
	});

	it(oneLine`
		leaves an entry pinning nothing alone when the mutation keeps the collection
		tag warm: that entry is what the tag covers
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:slot:': ['slot:&|ns:entry-bare'],
			'ns:scoped-cache-index:fingerprint:slot:owner=alpha': [
				'slot:&owner=,alpha,&|ns:entry-alpha',
			],
		};

		await purgeScopedCache(cache, 'slot', [], null, {
			rowFingerprints: [{
				collection: 'slot',
				pinnedScope: { id: ['1'], method: ['spaced'], owner: ['alpha'] },
			}],
			changed: ['method'],
			indexPath: 'owner',
			includeBareFingerprint: false,
		});

		expect(cache.delete).not.toHaveBeenCalledWith('ns:entry-bare');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-alpha');
	});

	it(oneLine`
		still purges what a hook declared: it names a pin, not the rows the mutation
		wrote, and nothing read back can resolve it
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:other:': ['other:&x=,y,&|ns:entry-x'],
		};

		await purgeScopedCache(
			cache,
			'slot',
			[
				scopedCacheFingerprintOf('slot', [{ field: 'id', value: 1 }]),
				scopedCacheFingerprintOf('other', [{ field: 'x', value: 'y' }]),
			],
			null,
			{
				rowFingerprints: [{
					collection: 'slot',
					pinnedScope: { id: ['1'], method: ['spaced'], owner: ['alpha'] },
				}],
				changed: ['method'],
				indexPath: 'owner',
				declaredFingerprints: [
					{ collection: 'other', pinnedScope: { x: ['y'] } },
				],
			},
		);

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-x');
	});

	it(oneLine`
		leaves an entry bound to another value of the field a hook declared: no row
		carrying that pin is in it
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:other:': [
				'other:&x=,z,&|ns:entry-z',
			],
		};

		await purgeScopedCache(
			cache,
			'slot',
			[scopedCacheFingerprintOf('other', [{ field: 'x', value: 'y' }])],
			null,
			{
				rowFingerprints: [{
					collection: 'slot',
					pinnedScope: { owner: ['alpha'] },
				}],
				changed: null,
				indexPath: 'owner',
				declaredFingerprints: [
					{ collection: 'other', pinnedScope: { x: ['y'] } },
				],
			},
		);

		expect(cache.delete).not.toHaveBeenCalledWith('ns:entry-z');
	});

	it(oneLine`
		purges by the pins it holds when it is shown no rows, which is what a purge
		that knows none can do: the declared pin, and the bare tag's own reach
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:slot:': ['slot:&|ns:entry-bare'],
			'ns:scoped-cache-index:fingerprint:slot:owner=alpha': [
				'slot:&id=,1,&owner=,alpha,&|ns:entry-one',
				'slot:&id=,2,&owner=,alpha,&|ns:entry-two',
			],
		};

		await purgeScopedCache(
			cache,
			'slot',
			[scopedCacheFingerprintOf('slot', [{ field: 'id', value: 1 }])],
			null,
		);

		// The bare tag it carries covers the read that could not be narrowed, and
		// the declared pin covers the entry bound to that value — the entry bound to
		// another value of the same field stands.
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-bare');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-one');
		expect(cache.delete).not.toHaveBeenCalledWith('ns:entry-two');
	});

	it(oneLine`
		leaves an entry pinning nothing alone when the only pin declared names a
		value: a cancelled write says one slice moved, not that the collection did
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:slot:': ['slot:&|ns:entry-bare'],
			'ns:scoped-cache-index:fingerprint:slot:owner=alpha': [
				'slot:&owner=,alpha,&|ns:entry-alpha',
			],
		};

		await purgeScopedCache(
			cache,
			'slot',
			[scopedCacheFingerprintOf('slot', [{ field: 'owner', value: 'alpha' }])],
			null,
			{ includeBareFingerprint: false },
		);

		expect(cache.delete).not.toHaveBeenCalledWith('ns:entry-bare');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-alpha');
	});

	it(oneLine`
		records the collection tag its rows carry, so the retry that replays the
		record by pin still reaches the reads no value narrows
	`, async () => {
		vi.mocked(useRedis).mockReturnValue({
			sscan: vi.fn(async () => {
				throw new Error('redis is down');
			}),
			scan,
			eval: evalScript,
			pipeline: () => {
				const chain: any = {
					incr: () => chain,
					expire: () => chain,
					srem: () => chain,
					exec: async () => [],
				};

				return chain;
			},
		} as any);

		await purgeScopedCache(cache, 'slot', [], null, {
			rowFingerprints: [{
				collection: 'slot',
				pinnedScope: { owner: ['alpha'] },
			}],
			changed: null,
			indexPath: 'owner',
		});

		expect(recordPendingScopedCachePurge).toHaveBeenCalledWith(
			{
				mode: 'slices',
				collection: 'slot',
				scopedCacheFingerprints: ['slot:&owner=,alpha,&', 'slot:&'],
			},
			expect.any(Error),
		);
	});
});
