import { oneLine } from '@directus/utils';
import type { Keyv } from 'keyv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { purgeScopedCache } from './purge.js';
import { scopedCacheFingerprintOf } from './fingerprint.js';
import {
	redisConfigAvailable,
	useCacheRedis,
	useRedis,
} from '../redis/index.js';
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

// A purge holding no rows reads the collection's sets off its registry, so the
// registry answers with the sets the case declared under that collection, those
// a trailing-star MATCH names when one is sent.
const sscan = vi.fn(async (key: string, _cursor: string, ...options: unknown[]) => {
	const registryPrefix = 'ns:scoped-cache-index:fingerprint-registry:';

	if (key.startsWith(registryPrefix)) {
		const collection = key.slice(registryPrefix.length);

		const setPrefix = options[0] === 'MATCH'
			? String(options[1]).slice(0, -1)
			: `ns:scoped-cache-index:fingerprint:${collection}:`;

		return ['0', Object.keys(members).filter((set) => set.startsWith(setPrefix))];
	}

	return ['0', members[key] ?? []];
});

const scan = vi.fn(async () => ['0', []]);

const scopedCacheRegistryPrune = vi.fn(async (
	_keyCount: number,
	_registryKey: string,
	...indexKeys: string[]
) => indexKeys);

const evalScript = vi.fn(async (
	_script: string,
	numKeys: number,
	...args: string[]
) => {
	swept.push(args.slice(2, numKeys));
	return [];
});

beforeEach(() => {
	vi.clearAllMocks();
	members = {};
	swept.length = 0;

	vi.mocked(useLogger).mockReturnValue({ info: vi.fn(), warn: vi.fn() } as any);
	vi.mocked(listPendingScopedCachePurges).mockResolvedValue([]);
	vi.mocked(redisConfigAvailable).mockReturnValue(true);
	vi.mocked(useCacheRedis).mockImplementation(() => useRedis());

	vi.mocked(useRedis).mockReturnValue({
		sscan,
		scan,
		scopedCacheRegistryPrune,
		eval: evalScript,
		defineCommand: vi.fn(),
		scopedCacheEpochBump: vi.fn(),
		pipeline: () => {
			const chain: any = {
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

	it(oneLine`
		reads the bare set, the one its row owns, and the home pin set of each value
		it carries, and no other
	`, async () => {
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
			'ns:scoped-cache-index:fingerprint:slot:pin:id=1',
			'ns:scoped-cache-index:fingerprint:slot:pin:method=spaced',
			'ns:scoped-cache-index:fingerprint:slot:pin:owner=alpha',
		]);
	});

	it(oneLine`
		drops an entry pinned off the index path from its home pin set, and leaves
		the one pinned to another value there
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:slot:pin:id=1': [
				'slot:&id=,1,&view=,method,&|ns:entry-one',
			],
			'ns:scoped-cache-index:fingerprint:slot:pin:id=2': [
				'slot:&id=,2,&view=,method,&|ns:entry-two',
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

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-one');
		expect(cache.delete).not.toHaveBeenCalledWith('ns:entry-two');

		expect(srem).toHaveBeenCalledWith(
			'ns:scoped-cache-index:fingerprint:slot:pin:id=1',
			'slot:&id=,1,&view=,method,&|ns:entry-one',
		);
	});

	it(oneLine`
		drops a read pinning a row's key and a shared boolean, filed under the key,
		when a write flips that boolean on the row
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:slot:pin:id=7': [
				'slot:&enabled=,true,&id=,7,&view=,label,&|ns:entry-seven',
			],
		};

		// The row before and after the write: `enabled` flipped to false.
		await purgeScopedCache(cache, 'slot', [], null, {
			rowFingerprints: [
				{
					collection: 'slot',
					pinnedScope: { enabled: ['true'], id: ['7'], owner: ['alpha'] },
				},
				{
					collection: 'slot',
					pinnedScope: { enabled: ['false'], id: ['7'], owner: ['alpha'] },
				},
			],
			changed: ['enabled'],
			indexPath: 'owner',
		});

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-seven');
	});

	it(oneLine`
		drops a read homed under its declared tenant when a write flips the shared
		boolean it also pins
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:slot:pin:tenant=acme': [
				'slot:&enabled=,true,&tenant=,acme,&view=,label,&|ns:entry-acme',
			],
		};

		// The row before and after the write: `enabled` flipped to false.
		await purgeScopedCache(cache, 'slot', [], null, {
			rowFingerprints: [
				{
					collection: 'slot',
					pinnedScope: { enabled: ['true'], id: ['7'], tenant: ['acme'] },
				},
				{
					collection: 'slot',
					pinnedScope: { enabled: ['false'], id: ['7'], tenant: ['acme'] },
				},
			],
			changed: ['enabled'],
			indexPath: 'owner',
		});

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-acme');
	});

	// A build ranking home pins another way filed the same read under the boolean:
	// the write reads every field and value its rows carry, so it finds it there.
	it(oneLine`
		drops the same read filed under the shared boolean instead of the key
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:slot:pin:enabled=true': [
				'slot:&enabled=,true,&id=,7,&view=,label,&|ns:entry-seven',
			],
		};

		await purgeScopedCache(cache, 'slot', [], null, {
			rowFingerprints: [{
				collection: 'slot',
				pinnedScope: { enabled: ['true'], id: ['7'], owner: ['alpha'] },
			}],
			changed: ['enabled'],
			indexPath: 'owner',
		});

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-seven');
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

		// One pass per set the row can drop something in — the bare one plus one per
		// value it carries — sent together, and the first of them takes a second
		// page once the round is back.
		expect(sscan.mock.calls.map(([key, cursor]) => [key, cursor])).toEqual([
			['ns:scoped-cache-index:fingerprint:slot:', '0'],
			['ns:scoped-cache-index:fingerprint:slot:pin:id=1', '0'],
			['ns:scoped-cache-index:fingerprint:slot:pin:method=spaced', '0'],
			['ns:scoped-cache-index:fingerprint:slot:pin:owner=alpha', '0'],
			['ns:scoped-cache-index:fingerprint:slot:', '7'],
		]);

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-first');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-second');
	});

	it(oneLine`
		leaves an entry pinning nothing alone when the mutation keeps the collection
		pin warm: that entry is what the pin covers
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
		reads a hook's pin on another collection off that collection's own index
		bucket and the home pin sets its registry names, rather than scanning the
		keyspace
	`, async () => {
		members = {
			'ns:scoped-cache-index:fingerprint:other:x=y': [
				'other:&x=,y,&|ns:entry-x',
			],
			'ns:scoped-cache-index:fingerprint:other:pin:id=3': [
				'other:&id=,3,&|ns:entry-home',
			],
		};

		await purgeScopedCache(
			cache,
			'slot',
			[],
			{
				schema: {
					collections: { other: { scopedCacheFields: ['x'] } },
					relations: [],
				},
			} as any,
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

		expect(sscan).toHaveBeenCalledWith(
			'ns:scoped-cache-index:fingerprint-registry:other',
			'0',
			'MATCH',
			'ns:scoped-cache-index:fingerprint:other:pin:*',
			'COUNT',
			1000,
		);

		expect(scan).not.toHaveBeenCalled();

		expect(sscan).toHaveBeenCalledWith(
			'ns:scoped-cache-index:fingerprint:other:x=y',
			'0',
			'COUNT',
			1000,
		);

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-x');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-home');
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
		that knows none can do: the declared pin, and the bare pin's own reach
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

		// The bare pin it carries covers the read that could not be narrowed, and
		// the declared pin covers the entry bound to that value — the entry bound to
		// another value of the same field stands.
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-bare');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-one');
		expect(cache.delete).not.toHaveBeenCalledWith('ns:entry-two');
	});

	it(oneLine`
		drops an entry pinning nothing when the only pin declared names a value:
		a read no value narrows holds that slice's rows too
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

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-bare');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-alpha');
	});

	it(oneLine`
		records the collection pin its rows carry, so the retry that replays the
		record by pin still reaches the reads no value narrows
	`, async () => {
		vi.mocked(useRedis).mockReturnValue({
			sscan: vi.fn(async () => {
				throw new Error('redis is down');
			}),
			scan,
			eval: evalScript,
			defineCommand: vi.fn(),
			scopedCacheEpochBump: vi.fn(),
			pipeline: () => {
				const chain: any = {
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
