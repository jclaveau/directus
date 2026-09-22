import { oneLine } from '@directus/utils';
import type { Keyv } from 'keyv';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { purgeScopedCache } from './purge.js';
import { redisConfigAvailable, useRedis } from '../redis/index.js';
import { useLogger } from '../logger/index.js';
import { listPendingScopedCachePurges } from '../scoped-cache-pending-purges.js';

// hoisted: the modules under test read `const env = useEnv()` at load, before a
// plain `const env` below would be initialised (temporal dead zone).
const env = vi.hoisted(() => {
	return {
		CACHE_AUTO_PURGE_MODE: 'scoped',
		CACHE_STORE: 'redis',
		CACHE_NAMESPACE: 'ns',
		CACHE_SCOPED_MAX_PINS_PER_COLLECTION: 250,
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

const BARE = 'ns:scoped-cache-index:idx:slot:';
const ALPHA = 'ns:scoped-cache-index:idx:slot:owner=alpha';

// One row of `slot`, owned by alpha, whose `method` the write rewrote.
const row = 'slot:&id=,1,&method=,spaced,&owner=,alpha,&';

function purge(options: Record<string, unknown>) {
	return purgeScopedCache(cache, 'slot', [], null, {
		rowFingerprints: [row],
		changed: ['method'],
		ownerPath: 'owner',
		...options,
	});
}

describe('a purge shown the rows it wrote', () => {
	it(oneLine`
		drops the entries whose whole bound the row satisfies, and leaves the one
		bound to another value of a field the row also carries
	`, async () => {
		members = {
			[BARE]: ['slot:&|ns:entry-bare'],
			[ALPHA]: [
				'slot:&owner=,alpha,&|ns:entry-alpha',
				'slot:&method=,slow,&owner=,alpha,&|ns:entry-alpha-slow',
			],
		};

		await purge({});

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-bare');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-alpha');
		expect(cache.delete).not.toHaveBeenCalledWith('ns:entry-alpha-slow');
	});

	it('reads the bare set and the one its row owns, and no other', async () => {
		await purge({});

		expect(sscan.mock.calls.map(([key]) => key)).toEqual([BARE, ALPHA]);
	});

	it(oneLine`
		keeps an entry bound to fields the update never rewrote: its response cannot
		have changed, whichever slice the row sits in
	`, async () => {
		members = {
			[ALPHA]: ['slot:&owner=,alpha,&fields=,title,&|ns:entry-title'],
		};

		await purge({});

		expect(cache.delete).not.toHaveBeenCalled();
	});

	it(oneLine`
		drops that same entry for an insert or a delete, where the row entered or
		left the result set whichever columns it carries
	`, async () => {
		members = {
			[ALPHA]: ['slot:&owner=,alpha,&fields=,title,&|ns:entry-title'],
		};

		await purge({ changed: null });

		expect(cache.delete).toHaveBeenCalledWith('ns:entry-title');
	});

	it(oneLine`
		removes the matched member from the set it was found in, so a later write to
		the same owner does not test a key that is already gone
	`, async () => {
		members = {
			[ALPHA]: [
				'slot:&owner=,alpha,&|ns:entry-alpha',
				'slot:&method=,slow,&owner=,alpha,&|ns:entry-alpha-slow',
			],
		};

		await purge({});

		expect(srem)
			.toHaveBeenCalledWith(ALPHA, 'slot:&owner=,alpha,&|ns:entry-alpha');

		expect(srem).toHaveBeenCalledTimes(1);
	});

	it('reads a set larger than one page to its end', async () => {
		sscan.mockImplementationOnce(async () => {
			return ['7', ['slot:&|ns:entry-first']];
		});

		sscan.mockImplementationOnce(async () => {
			return ['0', ['slot:&|ns:entry-second']];
		});

		await purge({ ownerPath: null });

		expect(sscan.mock.calls.map(([, cursor]) => cursor)).toEqual(['0', '7']);
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-first');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-second');
	});

	it(oneLine`
		leaves an entry pinning nothing alone when the mutation keeps the collection
		tag warm: that entry is what the tag covers
	`, async () => {
		members = {
			[BARE]: ['slot:&|ns:entry-bare'],
			[ALPHA]: ['slot:&owner=,alpha,&|ns:entry-alpha'],
		};

		await purge({ includeCollectionTag: false });

		expect(cache.delete).not.toHaveBeenCalledWith('ns:entry-bare');
		expect(cache.delete).toHaveBeenCalledWith('ns:entry-alpha');
	});

	it(oneLine`
		still sweeps a tag a hook declared: it names a slice, not the rows the
		mutation wrote, and nothing read back can resolve it
	`, async () => {
		const hookTag = { collection: 'other', field: 'x', value: 'y' };

		await purgeScopedCache(
			cache,
			'slot',
			[{ collection: 'slot', field: 'id', value: 1 }, hookTag],
			null,
			{
				rowFingerprints: [row],
				changed: ['method'],
				ownerPath: 'owner',
				sweepScopedCacheTags: [hookTag],
			},
		);

		expect(swept).toEqual([['ns:scoped-cache-index:tag:other:x=y']]);
	});

	it(oneLine`
		sweeps its tags whole when it is shown no rows, which is what a purge that
		knows none can do
	`, async () => {
		await purgeScopedCache(
			cache,
			'slot',
			[{ collection: 'slot', field: 'id', value: 1 }],
			null,
		);

		expect(sscan).not.toHaveBeenCalled();

		expect(swept).toEqual([[
			'ns:scoped-cache-index:tag:slot',
			'ns:scoped-cache-index:tag:slot:id=1',
		]]);
	});
});
