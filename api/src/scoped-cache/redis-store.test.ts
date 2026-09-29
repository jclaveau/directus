import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	parseScopedCacheIndexMember,
	redisScopedCacheStore,
	renderScopedCacheIndexMember,
	scopedCacheEpochBumpScript,
	scopedCacheFingerprintFiledIndexKeys,
	scopedCacheFingerprintIndexKeys,
	scopedCacheHomePin,
	scopedCacheIndexFileScript,
	scopedCacheIndexReapScript,
	scopedCacheLegacyBareAdoptScript,
	scopedCacheCollectionIndexKeysRegisterScript,
	scopedCacheCollectionIndexKeysPruneScript,
	scopedCacheRowHomePinKeys,
	scopedCacheRowIndexKeys,
	scopedCacheSweepMoveScript,
} from './redis-store.js';
import { parseScopedCacheFingerprint } from './fingerprint.js';

const env = vi.hoisted((): Record<string, string> => {
	return { CACHE_NAMESPACE: 'scalabus' };
});

vi.mock('@directus/env', () => {
	return { useEnv: () => env };
});

const srem = vi.fn();
const unlink = vi.fn();
const indexFile = vi.fn();
const pipelineExec = vi.fn(async (): Promise<unknown[]> => []);
const scopedCacheCollectionIndexKeysRegister = vi.fn();
const scopedCacheCollectionIndexKeysPrune = vi.fn();
const pttl = vi.fn();
const defineCommand = vi.fn();
const scopedCacheEpochBump = vi.fn();
const scopedCacheIndexReap = vi.fn();
const scan = vi.fn();
const sscan = vi.fn();
const sadd = vi.fn();
const exists = vi.fn();
const scopedCacheLegacyBareAdopt = vi.fn();

// The marker and the wholesale counter agreeing: a reap has vouched for the
// index-key sets since the last flush.
const mget = vi.fn(async (): Promise<(string | null)[]> => ['7', '7']);
const get = vi.fn();
const set = vi.fn();
const evalScript = vi.fn();
const onEvent = vi.fn();
const redisState = { status: 'connecting' };

vi.mock('../redis/index.js', () => {
	return {
		useCacheRedis: () => {
			return {
				defineCommand,
				scopedCacheEpochBump,
				scopedCacheIndexReap,
				scopedCacheCollectionIndexKeysRegister,
				scopedCacheCollectionIndexKeysPrune,
				pttl,
				scan,
				sscan,
				sadd,
				exists,
				scopedCacheLegacyBareAdopt,
				mget,
				get,
				set,
				eval: evalScript,
				on: onEvent,
				status: redisState.status,
				pipeline: () => {
					return {
						srem,
						unlink,
						scopedCacheIndexFile: indexFile,
						exec: pipelineExec,
					};
				},
			};
		},
	};
});

describe('scopedCacheFingerprintIndexKeys', () => {
	it('names the set by the collection and the value the read pinned', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint(
				'slot:&method=,spaced,&view=,id,&zone.region.owner=,ana,&',
			),
			'zone.region.owner',
			[],
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:zone.region.owner=ana',
		]);
	});

	it('files a read bounded to a list of values under each of them', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('slot:&zone.region.owner=,ana,bo,&'),
			'zone.region.owner',
			[],
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:zone.region.owner=ana',
			'scalabus:scoped-cache-index:fingerprint:slot:zone.region.owner=bo',
		]);
	});

	it('files a read pinning every axis but the index path under its home pin', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('slot:&method=,spaced,&view=,id,&'),
			'zone.region.owner',
			[],
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:pin:method=spaced',
		]);
	});

	it(oneLine`
		files a read pinning the primary key and a shared boolean under the key
	`, () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('slot:&enabled=,true,&id=,7,&view=,id,&'),
			'owner',
			['id'],
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:slot:pin:id=7']);
	});

	it('files a read of a collection with no index path under its home pin', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('loose:&id=,4,7,&view=,id,&'),
			null,
			[],
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:loose:pin:id=4',
			'scalabus:scoped-cache-index:fingerprint:loose:pin:id=7',
		]);
	});

	it('files a read pinning only its view bare', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('loose:&view=,id,&'),
			null,
			[],
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:loose:bare']);
	});

	it('files a home pin by its escaped key and value', () => {
		expect(scopedCacheFingerprintIndexKeys(
			{ collection: 'note', pinnedScope: { view: ['a,b'] } },
			null,
			[],
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:note:pin:\\view=a\\,b',
		]);
	});

	it('escapes a value carrying a separator, so its set is its own', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('slot:&zone.region.owner=,a\\,b,&'),
			'zone.region.owner',
			[],
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:zone.region.owner=a\\,b',
		]);
	});

	// A collection may declare a column named after an Object member, and the
	// index path is looked up by column name.
	it('files a read pinning nothing bare, whatever the path is named', () => {
		expect(scopedCacheFingerprintIndexKeys(
			{ collection: 'slot' },
			'constructor',
			[],
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:slot:bare']);
	});

	it(oneLine`
		files a read under an index path named bare apart from the bare set, as
		every index value's set carries a =
	`, () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('slot:&bare=,ana,&'),
			'bare',
			[],
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:slot:bare=ana']);
	});

	it('files a read under an index path named after an object member', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('slot:&constructor=,ana,&'),
			'constructor',
			[],
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:slot:constructor=ana']);
	});
});

describe('scopedCacheFingerprintFiledIndexKeys', () => {
	it('files a read pinning the index path under its value alone', () => {
		expect(scopedCacheFingerprintFiledIndexKeys(
			parseScopedCacheFingerprint('slot:&id=,7,&owner=,ana,&'),
			'owner',
			['id'],
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:owner=ana',
		]);
	});

	it(oneLine`
		files a home-pinned read in the legacy bare set too, the one set an older
		build's write reads for it
	`, () => {
		expect(scopedCacheFingerprintFiledIndexKeys(
			parseScopedCacheFingerprint('slot:&id=,7,&'),
			'owner',
			['id'],
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:pin:id=7',
			'scalabus:scoped-cache-index:fingerprint:slot:',
		]);
	});

	it('files a bare read in the bare set and the legacy bare set', () => {
		expect(scopedCacheFingerprintFiledIndexKeys(
			{ collection: 'loose' },
			null,
			[],
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:loose:bare',
			'scalabus:scoped-cache-index:fingerprint:loose:',
		]);
	});
});

describe('scopedCacheRowIndexKeys', () => {
	it('reads the bare set and the one each written row owns', () => {
		expect(scopedCacheRowIndexKeys(
			'slot',
			[
				parseScopedCacheFingerprint(
					'slot:&id=,1,&method=,spaced,&zone.region.owner=,ana,&',
				),
				parseScopedCacheFingerprint(
					'slot:&id=,2,&method=,massed,&zone.region.owner=,bo,&',
				),
			],
			'zone.region.owner',
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:bare',
			'scalabus:scoped-cache-index:fingerprint:slot:zone.region.owner=ana',
			'scalabus:scoped-cache-index:fingerprint:slot:zone.region.owner=bo',
		]);
	});

	it('reads one set for two rows of the same index value', () => {
		expect(scopedCacheRowIndexKeys(
			'slot',
			[
				parseScopedCacheFingerprint('slot:&id=,1,&zone.region.owner=,ana,&'),
				parseScopedCacheFingerprint('slot:&id=,2,&zone.region.owner=,ana,&'),
			],
			'zone.region.owner',
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:bare',
			'scalabus:scoped-cache-index:fingerprint:slot:zone.region.owner=ana',
		]);
	});

	it('reads the bare set alone for a row whose index value never resolved', () => {
		expect(scopedCacheRowIndexKeys(
			'slot',
			[parseScopedCacheFingerprint('slot:&id=,1,&')],
			'zone.region.owner',
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:slot:bare']);
	});

	// A collection may declare a column named after an Object member, and the
	// index path is looked up by column name.
	it('reads the bare set alone for a row pinning nothing, on any path', () => {
		expect(scopedCacheRowIndexKeys(
			'slot',
			[{ collection: 'slot' }],
			'constructor',
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:slot:bare']);
	});

	it('reads the set of an index path named after an object member', () => {
		expect(scopedCacheRowIndexKeys(
			'slot',
			[parseScopedCacheFingerprint('slot:&constructor=,ana,&')],
			'constructor',
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:bare',
			'scalabus:scoped-cache-index:fingerprint:slot:constructor=ana',
		]);
	});

	it('reads the bare set alone for a collection with no index path', () => {
		expect(scopedCacheRowIndexKeys(
			'loose',
			[parseScopedCacheFingerprint('loose:&id=,1,&')],
			null,
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:loose:bare']);
	});

	it('names the bare set even when the write carried no row', () => {
		expect(scopedCacheRowIndexKeys('slot', [], 'zone.region.owner'))
			.toEqual(['scalabus:scoped-cache-index:fingerprint:slot:bare']);
	});
});

describe('scopedCacheHomePin', () => {
	it(oneLine`
		picks the primary key when the read pins it, over a field every row shares
	`, () => {
		expect(scopedCacheHomePin(
			parseScopedCacheFingerprint('slot:&enabled=,true,&id=,7,&'),
			['id'],
		)).toEqual({ field: 'id', pinnedValues: ['7'] });
	});

	it('picks the primary key even where it pins more values', () => {
		expect(scopedCacheHomePin(
			parseScopedCacheFingerprint('slot:&enabled=,true,&id=,1,2,3,&'),
			['id'],
		)).toEqual({ field: 'id', pinnedValues: ['1', '2', '3'] });
	});

	it(oneLine`
		picks the fewest values when the read leaves the primary key unpinned
	`, () => {
		expect(scopedCacheHomePin(
			parseScopedCacheFingerprint('slot:&enabled=,true,&owner=,a,b,&'),
			['id'],
		)).toEqual({ field: 'enabled', pinnedValues: ['true'] });
	});

	it(oneLine`
		picks the first declared scope field the read pins, over one with fewer
		values
	`, () => {
		expect(scopedCacheHomePin(
			parseScopedCacheFingerprint('slot:&enabled=,true,&tenant=,a,b,&'),
			['id', 'tenant', 'enabled'],
		)).toEqual({ field: 'tenant', pinnedValues: ['a', 'b'] });
	});

	// The declared order is the admin's lever: listing `enabled` first homes the
	// same read under the shared boolean.
	it(oneLine`
		picks by declared order, so reordering the scope fields moves the home
	`, () => {
		expect(scopedCacheHomePin(
			parseScopedCacheFingerprint('slot:&enabled=,true,&tenant=,a,&'),
			['id', 'enabled', 'tenant'],
		)).toEqual({ field: 'enabled', pinnedValues: ['true'] });
	});

	it('picks the primary key over every declared scope field', () => {
		expect(scopedCacheHomePin(
			parseScopedCacheFingerprint('slot:&enabled=,true,&id=,7,&tenant=,a,&'),
			['id', 'tenant', 'enabled'],
		)).toEqual({ field: 'id', pinnedValues: ['7'] });
	});

	it('picks the pinned field with the fewest values', () => {
		expect(scopedCacheHomePin(
			parseScopedCacheFingerprint('slot:&id=,1,2,3,&owner=,alpha,beta,&'),
			[],
		)).toEqual({ field: 'owner', pinnedValues: ['alpha', 'beta'] });
	});

	it('breaks a tie on the lowest pin key, whatever order the pins came in', () => {
		expect(scopedCacheHomePin({
			collection: 'slot',
			pinnedScope: { owner: ['alpha'], method: ['spaced'] },
		}, [])).toEqual({ field: 'method', pinnedValues: ['spaced'] });
	});

	it(oneLine`
		counts a repeated value once, so a member parsed back picks the field its
		filing did
	`, () => {
		const filed = {
			collection: 'slot',
			pinnedScope: { method: ['spaced', 'spaced', 'spaced'], owner: ['a', 'b'] },
		};

		expect(scopedCacheHomePin(filed, [])).toEqual({
			field: 'method',
			pinnedValues: ['spaced'],
		});

		expect(scopedCacheHomePin(parseScopedCacheIndexMember(
			renderScopedCacheIndexMember(filed, 'ns:abc'),
		).fingerprint, [])).toEqual({ field: 'method', pinnedValues: ['spaced'] });
	});

	it(oneLine`
		never picks a field pinned to no value, so the entry is filed somewhere
	`, () => {
		expect(scopedCacheHomePin({
			collection: 'slot',
			pinnedScope: { method: [], owner: ['alpha', 'beta'] },
		}, [])).toEqual({ field: 'owner', pinnedValues: ['alpha', 'beta'] });
	});

	it('answers null for a read pinning nothing', () => {
		expect(scopedCacheHomePin({ collection: 'slot', viewFields: ['id'] }, []))
			.toBe(null);
	});
});

describe('scopedCacheRowHomePinKeys', () => {
	it('reads one set per field and value the written rows carry, once', () => {
		expect(scopedCacheRowHomePinKeys('slot', [
			parseScopedCacheFingerprint('slot:&id=,1,&owner=,alpha,&'),
			parseScopedCacheFingerprint('slot:&id=,2,&owner=,alpha,&'),
		])).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:pin:id=1',
			'scalabus:scoped-cache-index:fingerprint:slot:pin:owner=alpha',
			'scalabus:scoped-cache-index:fingerprint:slot:pin:id=2',
		]);
	});

	it('reads no home pin for a write carrying no row', () => {
		expect(scopedCacheRowHomePinKeys('slot', [])).toEqual([]);
	});

	// The invariant the row scan rests on: a row drops an entry only by carrying
	// one of its values on every field it pins, so on its home pin too.
	it(oneLine`
		names the set every entry a row drops is filed in, whichever field is its
		home pin
	`, () => {
		const row = parseScopedCacheFingerprint(
			'slot:&id=,7,&method=,spaced,&owner=,alpha,&',
		);

		const readSets = new Set([
			...scopedCacheRowIndexKeys('slot', [row], 'owner'),
			...scopedCacheRowHomePinKeys('slot', [row]),
		]);

		for (const filed of [
			'slot:&id=,7,&view=,label,&',
			'slot:&id=,6,7,8,&method=,spaced,&',
			'slot:&id=,7,&method=,massed,spaced,&',
			'slot:&owner=,alpha,beta,&view=,id,&',
			'slot:&view=,id,&',
			'slot:&',
		]) {
			const filedIn = scopedCacheFingerprintIndexKeys(
				parseScopedCacheFingerprint(filed),
				'owner',
				[],
			);

			expect(filedIn.some((indexKey) => readSets.has(indexKey))).toBe(true);
		}
	});
});

describe('renderScopedCacheIndexMember', () => {
	it('carries the query case and the key it protects in one member', () => {
		expect(renderScopedCacheIndexMember(
			parseScopedCacheFingerprint('slot:&method=,spaced,&'),
			'ns:abc',
		)).toBe('slot:&method=,spaced,&|ns:abc');
	});

	it('reads a member back, splitting on the fingerprint\'s own terminator', () => {
		expect(parseScopedCacheIndexMember('slot:&method=,spaced,&|ns:abc'))
			.toEqual({
				fingerprint: parseScopedCacheFingerprint('slot:&method=,spaced,&'),
				key: 'ns:abc',
			});
	});

	it('reads a key carrying a pipe of its own back whole', () => {
		expect(parseScopedCacheIndexMember('slot:&|ns:a|b'))
			.toEqual({
				fingerprint: parseScopedCacheFingerprint('slot:&'),
				key: 'ns:a|b',
			});
	});

	it('reads a member back past the escaped pipes its pinned values carry', () => {
		expect(parseScopedCacheIndexMember('slot:&owner=,a\\|b,c\\\\,&|ns:abc'))
			.toEqual({
				fingerprint: {
					collection: 'slot',
					pinnedScope: { owner: ['a|b', 'c\\'] },
				},
				key: 'ns:abc',
			});
	});

	it('round-trips a pinned value spelling a backslash then a pipe', () => {
		expect(parseScopedCacheIndexMember(renderScopedCacheIndexMember(
			{ collection: 'slot', pinnedScope: { owner: ['a\\|b', 'c|'] } },
			'ns:a|b',
		))).toEqual({
			fingerprint: {
				collection: 'slot',
				pinnedScope: { owner: ['a\\|b', 'c|'] },
			},
			key: 'ns:a|b',
		});
	});

	it(oneLine`
		round-trips a collection whose name carries a pipe, so the member still
		splits at the key it protects
	`, () => {
		expect(parseScopedCacheIndexMember(renderScopedCacheIndexMember(
			{ collection: 'a|b:&c', pinnedScope: { owner: ['alpha'] } },
			'ns:abc',
		))).toEqual({
			fingerprint: {
				collection: 'a|b:&c',
				pinnedScope: { owner: ['alpha'] },
			},
			key: 'ns:abc',
		});
	});

	it('reads a member holding no key as a fingerprint alone', () => {
		expect(parseScopedCacheIndexMember('slot:&'))
			.toEqual({ fingerprint: parseScopedCacheFingerprint('slot:&'), key: '' });
	});
});

describe('removeIndexedEntries', () => {
	beforeEach(() => srem.mockClear());

	it(oneLine`
		prunes a read bounded to a list of values from every value's set, not only
		the one the purge read it in
	`, async () => {
		const member = 'slot:&owner=,kappa,lambda,&view=,id,owner,&|cache-key';

		await redisScopedCacheStore().removeIndexedEntries(
			[{
				fingerprint: parseScopedCacheFingerprint(member.split('|')[0]!),
				key: 'cache-key',
				location: {
					indexKey: 'scalabus:scoped-cache-index:fingerprint:slot:owner=lambda',
					member,
				},
			}],
			'owner',
		);

		expect(srem.mock.calls).toEqual([
			[
				'scalabus:scoped-cache-index:fingerprint:slot:owner=lambda',
				member,
			],
			[
				'scalabus:scoped-cache-index:fingerprint:slot:owner=kappa',
				member,
			],
		]);
	});

	it(oneLine`
		prunes a read off the index path from every value's home pin set, and from
		the legacy bare set an older build filed it in
	`, async () => {
		const member = 'slot:&id=,4,7,&view=,id,&|cache-key';

		await redisScopedCacheStore().removeIndexedEntries(
			[{
				fingerprint: parseScopedCacheFingerprint(member.split('|')[0]!),
				key: 'cache-key',
				location: {
					indexKey: 'scalabus:scoped-cache-index:fingerprint:slot:',
					member,
				},
			}],
			'owner',
		);

		expect(srem.mock.calls).toEqual([
			['scalabus:scoped-cache-index:fingerprint:slot:', member],
			['scalabus:scoped-cache-index:fingerprint:slot:pin:id=4', member],
			['scalabus:scoped-cache-index:fingerprint:slot:pin:id=7', member],
		]);
	});

	it(oneLine`
		prunes a bare read from the bare set and from the legacy bare set a fill
		filed it in beside
	`, async () => {
		await redisScopedCacheStore().removeIndexedEntries(
			[{
				fingerprint: { collection: 'slot' },
				key: 'cache-key',
				location: {
					indexKey: 'scalabus:scoped-cache-index:fingerprint:slot:bare',
					member: 'slot:&|cache-key',
				},
			}],
			'owner',
		);

		expect(srem.mock.calls).toEqual([
			['scalabus:scoped-cache-index:fingerprint:slot:bare', 'slot:&|cache-key'],
			['scalabus:scoped-cache-index:fingerprint:slot:', 'slot:&|cache-key'],
		]);
	});

	it(oneLine`
		prunes a read off the index path from the set of every field it pins, so
		the one a build ranking them another way filed it in too
	`, async () => {
		const member = 'slot:&enabled=,true,&id=,7,&view=,id,&|cache-key';

		await redisScopedCacheStore().removeIndexedEntries(
			[{
				fingerprint: parseScopedCacheFingerprint(member.split('|')[0]!),
				key: 'cache-key',
				location: {
					indexKey: 'scalabus:scoped-cache-index:fingerprint:slot:pin:id=7',
					member,
				},
			}],
			'owner',
		);

		expect(srem.mock.calls).toEqual([
			['scalabus:scoped-cache-index:fingerprint:slot:pin:id=7', member],
			['scalabus:scoped-cache-index:fingerprint:slot:pin:enabled=true', member],
			['scalabus:scoped-cache-index:fingerprint:slot:', member],
		]);
	});

	it(oneLine`
		prunes where it found a member and its home pin's set, where no index path
		names the sets it would otherwise be in
	`, async () => {
		const member = 'slot:&owner=,kappa,&view=,id,&|cache-key';

		await redisScopedCacheStore().removeIndexedEntries(
			[{
				fingerprint: parseScopedCacheFingerprint(member.split('|')[0]!),
				key: 'cache-key',
				location: {
					indexKey: 'scalabus:scoped-cache-index:fingerprint:slot:owner=kappa',
					member,
				},
			}],
			null,
		);

		expect(srem.mock.calls).toEqual([
			[
				'scalabus:scoped-cache-index:fingerprint:slot:owner=kappa',
				member,
			],
			[
				'scalabus:scoped-cache-index:fingerprint:slot:pin:owner=kappa',
				member,
			],
			['scalabus:scoped-cache-index:fingerprint:slot:', member],
		]);
	});
});

describe('bumpPurgeEpochs', () => {
	beforeEach(() => {
		defineCommand.mockReset();
		scopedCacheEpochBump.mockReset();
	});

	it(oneLine`
		bumps every counter in one script call, holding each for the ttl
	`, async () => {
		await redisScopedCacheStore().bumpPurgeEpochs(
			['ns:scoped-cache-epoch:slot', 'ns:scoped-cache-epoch:*'],
			86400,
		);

		expect(defineCommand).toHaveBeenCalledWith(
			'scopedCacheEpochBump',
			{ lua: scopedCacheEpochBumpScript },
		);

		expect(scopedCacheEpochBump.mock.calls).toEqual([
			[2, 'ns:scoped-cache-epoch:slot', 'ns:scoped-cache-epoch:*', 86400],
		]);
	});

	// A counter recreated at `1` after it expired repeats the `1` a read may have
	// taken before its query, and that read then keeps rows the purge superseded.
	it('seeds a missing counter from the server clock before bumping it', () => {
		expect(scopedCacheEpochBumpScript).toContain(
			"local now = redis.call('TIME')\n"
			+ "local seed = now[1] .. "
			+ "string.format('%06d', tonumber(now[2]))",
		);

		expect(scopedCacheEpochBumpScript).toContain(
			"\tredis.call('SET', KEYS[i], seed, 'NX')\n"
			+ "\tredis.call('INCR', KEYS[i])",
		);
	});

	it('throws a bump the server refused, so the caller can say so', async () => {
		scopedCacheEpochBump
			.mockRejectedValue(new Error('OOM command not allowed'));

		await expect(redisScopedCacheStore().bumpPurgeEpochs(
			['ns:scoped-cache-epoch:slot'],
			86400,
		)).rejects.toThrow('OOM command not allowed');
	});
});

describe('fileIndexedEntries', () => {
	beforeEach(() => {
		for (const command of [
			indexFile,
			defineCommand,
			scopedCacheCollectionIndexKeysRegister,
		]) {
			command.mockReset();
		}
	});

	it(oneLine`
		files a collection's sets in one script call, naming the index-key set first
		and each set once, as a key
	`, async () => {
		await redisScopedCacheStore().fileIndexedEntries(
			[
				{
					fingerprint: parseScopedCacheFingerprint('slot:&owner=,ana,bo,&'),
					keys: ['key-a'],
					indexPath: 'owner',
					homePinFields: [],
				},
				{
					fingerprint: parseScopedCacheFingerprint('slot:&owner=,ana,&'),
					keys: ['key-b'],
					indexPath: 'owner',
					homePinFields: [],
				},
			],
			3600,
		);

		expect(defineCommand).toHaveBeenCalledWith(
			'scopedCacheIndexFile',
			{ lua: scopedCacheIndexFileScript },
		);

		expect(indexFile.mock.calls).toEqual([[
			4,
			'scalabus:scoped-cache-index:collection-index-keys:slot',
			'scalabus:scoped-cache-index:fingerprint:slot:owner=ana',
			'scalabus:scoped-cache-index:fingerprint:slot:owner=bo',
			'scalabus:scoped-cache-index:fingerprint:slot:owner=ana',
			3600,
			1,
			'slot:&owner=,ana,bo,&|key-a',
			1,
			'slot:&owner=,ana,bo,&|key-a',
			1,
			'slot:&owner=,ana,&|key-b',
		]]);
	});

	// The script decides which sets it creates; a separate register call would
	// send every name again on every refill.
	it('sends no register call of its own, on a first fill or a refill', async () => {
		const filing = {
			fingerprint: parseScopedCacheFingerprint('slot:&owner=,ana,&'),
			keys: ['key-a'],
			indexPath: 'owner',
			homePinFields: [],
		};

		await redisScopedCacheStore().fileIndexedEntries([filing], 60);
		await redisScopedCacheStore().fileIndexedEntries([filing], 60);

		expect(scopedCacheCollectionIndexKeysRegister).not.toHaveBeenCalled();

		expect(indexFile.mock.calls).toEqual([
			[
				2,
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'scalabus:scoped-cache-index:fingerprint:slot:owner=ana',
				60,
				1,
				'slot:&owner=,ana,&|key-a',
			],
			[
				2,
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'scalabus:scoped-cache-index:fingerprint:slot:owner=ana',
				60,
				1,
				'slot:&owner=,ana,&|key-a',
			],
		]);
	});

	it(oneLine`
		files a home pin's sets in the same call as the index path's, so the sets it
		creates are named where a collection-wide purge looks
	`, async () => {
		await redisScopedCacheStore().fileIndexedEntries(
			[
				{
					fingerprint: parseScopedCacheFingerprint('slot:&id=,7,8,&'),
					keys: ['key-a'],
					indexPath: 'owner',
					homePinFields: ['id'],
				},
				{
					fingerprint: parseScopedCacheFingerprint('slot:&owner=,ana,&'),
					keys: ['key-b'],
					indexPath: 'owner',
					homePinFields: ['id'],
				},
			],
			60,
		);

		expect(indexFile.mock.calls).toEqual([[
			5,
			'scalabus:scoped-cache-index:collection-index-keys:slot',
			'scalabus:scoped-cache-index:fingerprint:slot:pin:id=7',
			'scalabus:scoped-cache-index:fingerprint:slot:pin:id=8',
			'scalabus:scoped-cache-index:fingerprint:slot:',
			'scalabus:scoped-cache-index:fingerprint:slot:owner=ana',
			60,
			1,
			'slot:&id=,7,8,&|key-a',
			1,
			'slot:&id=,7,8,&|key-a',
			1,
			'slot:&id=,7,8,&|key-a',
			1,
			'slot:&owner=,ana,&|key-b',
		]]);
	});

	it('keeps one index-key set per collection', async () => {
		await redisScopedCacheStore().fileIndexedEntries(
			[
				{
					fingerprint: { collection: 'slot' },
					keys: ['key-a'],
					indexPath: null,
					homePinFields: [],
				},
				{
					fingerprint: { collection: 'note' },
					keys: ['key-b'],
					indexPath: null,
					homePinFields: [],
				},
			],
			60,
		);

		expect(indexFile.mock.calls).toEqual([
			[
				3,
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
				'scalabus:scoped-cache-index:fingerprint:slot:',
				60,
				1,
				'slot:&|key-a',
				1,
				'slot:&|key-a',
			],
			[
				3,
				'scalabus:scoped-cache-index:collection-index-keys:note',
				'scalabus:scoped-cache-index:fingerprint:note:bare',
				'scalabus:scoped-cache-index:fingerprint:note:',
				60,
				1,
				'note:&|key-b',
				1,
				'note:&|key-b',
			],
		]);
	});

	it('passes a never-expiring fill its ttl of 0 for the script', async () => {
		await redisScopedCacheStore().fileIndexedEntries(
			[{
				fingerprint: { collection: 'slot' },
				keys: ['key-a', 'key-a__expires_at'],
				indexPath: null,
				homePinFields: [],
			}],
			0,
		);

		expect(indexFile.mock.calls).toEqual([[
			3,
			'scalabus:scoped-cache-index:collection-index-keys:slot',
			'scalabus:scoped-cache-index:fingerprint:slot:bare',
			'scalabus:scoped-cache-index:fingerprint:slot:',
			0,
			2,
			'slot:&|key-a',
			'slot:&|key-a__expires_at',
			2,
			'slot:&|key-a',
			'slot:&|key-a__expires_at',
		]]);
	});

	// Sets that carry no member, so the argument count stays under its own cap
	// and only the set count can start the second call.
	it('starts a new call past 500 sets of one collection', async () => {
		await redisScopedCacheStore().fileIndexedEntries(
			Array.from({ length: 501 }, (_, index) => {
				return {
					fingerprint: parseScopedCacheFingerprint(
						`slot:&owner=,v${index},&`,
					),
					keys: [],
					indexPath: 'owner',
					homePinFields: [],
				};
			}),
			60,
		);

		expect(indexFile.mock.calls).toEqual([
			[
				501,
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				...Array.from({ length: 500 }, (_, index) => {
					return `scalabus:scoped-cache-index:fingerprint:slot:owner=v${index}`;
				}),
				60,
				...Array.from({ length: 500 }, () => 0),
			],
			[
				2,
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'scalabus:scoped-cache-index:fingerprint:slot:owner=v500',
				60,
				0,
			],
		]);
	});

	// Two sets, far under the set cap, whose members together pass 1000
	// arguments: only the member count can start the second call.
	it('starts a new call past 1000 members of one collection', async () => {
		await redisScopedCacheStore().fileIndexedEntries(
			['ada', 'bob'].map((owner) => {
				return {
					fingerprint: parseScopedCacheFingerprint(`slot:&owner=,${owner},&`),
					keys: Array.from({ length: 600 }, (_, index) => `key-${index}`),
					indexPath: 'owner',
					homePinFields: [],
				};
			}),
			60,
		);

		expect(indexFile.mock.calls).toEqual([
			[
				2,
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'scalabus:scoped-cache-index:fingerprint:slot:owner=ada',
				60,
				600,
				...Array.from({ length: 600 }, (_, index) => {
					return `slot:&owner=,ada,&|key-${index}`;
				}),
			],
			[
				2,
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'scalabus:scoped-cache-index:fingerprint:slot:owner=bob',
				60,
				600,
				...Array.from({ length: 600 }, (_, index) => {
					return `slot:&owner=,bob,&|key-${index}`;
				}),
			],
		]);
	});

	it(oneLine`
		throws a filing the server refused, so the caller skips the write
	`, async () => {
		pipelineExec.mockResolvedValueOnce([
			[new Error('OOM command not allowed'), null],
		]);

		await expect(redisScopedCacheStore().fileIndexedEntries(
			[{
				fingerprint: { collection: 'slot' },
				keys: ['key-a'],
				indexPath: null,
				homePinFields: [],
			}],
			60,
		)).rejects.toThrow('OOM command not allowed');
	});
});

// The hourly reap still names the sets it finds through this script, which is
// how a set an older build filed without naming it gets adopted.
describe('scopedCacheCollectionIndexKeysRegisterScript', () => {
	it(oneLine`
		only ever moves the expiry out and compares it in milliseconds
	`, () => {
		expect(scopedCacheCollectionIndexKeysRegisterScript).toContain(
			"local existed = redis.call('EXISTS', KEYS[1])\n"
			+ "redis.call('SADD', KEYS[1], unpack(ARGV, 2))",
		);

		expect(scopedCacheCollectionIndexKeysRegisterScript).toContain(
			"redis.call('PERSIST', KEYS[1])",
		);

		expect(scopedCacheCollectionIndexKeysRegisterScript).toContain(
			"local ttl = redis.call('PTTL', KEYS[1])\n"
			+ 'if existed == 0 or (ttl >= 0 and ttl < want) then\n'
			+ "\tredis.call('PEXPIRE', KEYS[1], want)",
		);
	});
});

describe('scopedCacheIndexFileScript', () => {
	// A set can exist while its name is gone (a flush dropping the index-key set
	// after a fill recreated the set, an eviction), and a collection-wide purge
	// reads only the index-key set: every fill names every set it files into.
	it('names every set of the call, whether it creates it or not', () => {
		expect(scopedCacheIndexFileScript).toContain(
			"local held = redis.call('PTTL', KEYS[1])\n"
			+ "local named = redis.call('SADD', KEYS[1], unpack(KEYS, 2))\n"
			+ 'if unbounded then',
		);
	});

	// Named after its set holds members, a name can be pruned as missing in
	// between, leaving the set filed with nothing naming it.
	it('names a set before filing into it', () => {
		expect(scopedCacheIndexFileScript).toMatch(
			/'SADD', KEYS\[1\][\s\S]*'SADD', KEYS\[i\]/,
		);
	});

	// TTL rounds to the nearest second, so a set's `left` can be 499 ms short:
	// one second more keeps the index-key set past it.
	it(oneLine`
		moves the index-key set's expiry only outward, past the longest-lived set,
		before touching any set
	`, () => {
		expect(scopedCacheIndexFileScript).toContain(
			'\telseif left >= want then\n'
			+ '\t\tlongest = math.max(longest, (left + 1) * 1000)',
		);

		expect(scopedCacheIndexFileScript).toContain(
			'elseif held == -2 or (held >= 0 and held < longest) then\n'
			+ "\tredis.call('PEXPIRE', KEYS[1], longest)",
		);

		expect(scopedCacheIndexFileScript).toMatch(
			/'PEXPIRE', KEYS\[1\][\s\S]*'SADD', KEYS\[i\]/,
		);
	});

	it(oneLine`
		keeps the index-key set with no expiry while a set it names has none
	`, () => {
		expect(scopedCacheIndexFileScript).toContain(
			'local unbounded = want <= 0\n',
		);

		expect(scopedCacheIndexFileScript).toContain(
			'\tif left == -1 then\n'
			+ '\t\tunbounded = true',
		);

		expect(scopedCacheIndexFileScript).toContain(
			'if unbounded then\n'
			+ '\tif held >= 0 then\n'
			+ "\t\tredis.call('PERSIST', KEYS[1])",
		);
	});

	it(oneLine`
		files each set's members and moves its own expiry only outward, or clears it
		for a ttl of 0
	`, () => {
		expect(scopedCacheIndexFileScript).toContain(
			'\tif count > 0 then\n'
			+ "\t\tredis.call('SADD', KEYS[i], unpack(ARGV, at + 1, at + count))\n"
			+ '\tend\n'
			+ '\tat = at + count + 1\n'
			+ '\tif want <= 0 then\n'
			+ '\t\tif lefts[i] >= 0 then\n'
			+ "\t\t\tredis.call('PERSIST', KEYS[i])\n"
			+ '\t\tend\n'
			+ '\telseif lefts[i] == -2 or (lefts[i] >= 0 and lefts[i] < want) then\n'
			+ "\t\tredis.call('EXPIRE', KEYS[i], want)",
		);
	});
});

describe('scanCollectionIndexedEntries', () => {
	beforeEach(() => {
		for (const command of [
			scan,
			sscan,
			scopedCacheCollectionIndexKeysPrune,
			mget,
		]) {
			command.mockReset();
		}
	});

	it(oneLine`
		reads the sets the collection's index-key set names that still exist, and never
		scans the keyspace
	`, async () => {
		sscan
			.mockResolvedValueOnce([
				'0',
				[
					'scalabus:scoped-cache-index:fingerprint:slot:bare',
					'scalabus:scoped-cache-index:fingerprint:slot:owner=gone',
				],
			])
			.mockResolvedValueOnce(['0', ['slot:&|key-a']]);

		scopedCacheCollectionIndexKeysPrune.mockResolvedValueOnce([
			'scalabus:scoped-cache-index:fingerprint:slot:bare',
		]);

		const scanned = [];

		for await (
			const page of redisScopedCacheStore().scanCollectionIndexedEntries('slot')
		) {
			scanned.push(page);
		}

		expect(scanned).toEqual([[{
			fingerprint: { collection: 'slot' },
			key: 'key-a',
			location: {
				indexKey: 'scalabus:scoped-cache-index:fingerprint:slot:bare',
				member: 'slot:&|key-a',
			},
		}]]);

		expect(scopedCacheCollectionIndexKeysPrune.mock.calls).toEqual([[
			3,
			'scalabus:scoped-cache-index:collection-index-keys:slot',
			'scalabus:scoped-cache-index:fingerprint:slot:bare',
			'scalabus:scoped-cache-index:fingerprint:slot:owner=gone',
		]]);

		expect(sscan.mock.calls).toEqual([
			[
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'0',
				'COUNT',
				1000,
			],
			['scalabus:scoped-cache-index:fingerprint:slot:bare', '0', 'COUNT', 1000],
		]);

		expect(mget.mock.calls).toEqual([[[
			'scalabus:scoped-cache-index:collection-index-keys-complete',
			'scalabus:scoped-cache-epoch:*',
		]]]);

		expect(scan).not.toHaveBeenCalled();
	});

	// A set filed while nothing named it — by an older build, or before a flush
	// that dropped the index-key set and not the set — is found only by a SCAN
	// until a reap names it.
	it.each([
		['no reap has written the marker', null, '7'],
		['a flush moved the counter past the marker', '7', '8'],
		['the counter expired after the marker was written', '7', null],
	])(oneLine`
		scans the keyspace for the collection's sets when %s
	`, async (_case, marker, flushEpoch) => {
		mget.mockResolvedValueOnce([marker, flushEpoch]);

		scan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:slot:name=ada'],
		]);

		sscan.mockResolvedValueOnce(['0', ['slot:&name=,ada,&|key-a']]);

		const scanned = [];

		for await (
			const page of redisScopedCacheStore().scanCollectionIndexedEntries('slot')
		) {
			scanned.push(page);
		}

		expect(scanned).toEqual([[{
			fingerprint: { collection: 'slot', pinnedScope: { name: ['ada'] } },
			key: 'key-a',
			location: {
				indexKey: 'scalabus:scoped-cache-index:fingerprint:slot:name=ada',
				member: 'slot:&name=,ada,&|key-a',
			},
		}]]);

		expect(scan.mock.calls).toEqual([[
			'0',
			'MATCH',
			'scalabus:scoped-cache-index:fingerprint:slot:*',
			'COUNT',
			1000,
		]]);

		expect(sscan.mock.calls).toEqual([[
			'scalabus:scoped-cache-index:fingerprint:slot:name=ada',
			'0',
			'COUNT',
			1000,
		]]);

		expect(scopedCacheCollectionIndexKeysPrune).not.toHaveBeenCalled();
	});

	// A reap finding no counter writes an empty marker, which stays good until a
	// flush creates one.
	it(oneLine`
		trusts the index-key set when the reap found no counter and there is still
		none
	`, async () => {
		mget.mockResolvedValueOnce(['', null]);
		sscan.mockResolvedValueOnce(['0', []]);

		for await (
			const _page of redisScopedCacheStore().scanCollectionIndexedEntries('slot')
		) {
			continue;
		}

		expect(sscan.mock.calls).toEqual([[
			'scalabus:scoped-cache-index:collection-index-keys:slot',
			'0',
			'COUNT',
			1000,
		]]);

		expect(scan).not.toHaveBeenCalled();
	});

	// Checked and removed in two steps, a fill recreating the set in between is
	// left holding members no index-key set names.
	it('drops a name only in the script that finds its set missing', () => {
		expect(scopedCacheCollectionIndexKeysPruneScript).toContain(
			"if redis.call('EXISTS', KEYS[i]) == 1 then\n"
			+ '\t\tlive[#live + 1] = KEYS[i]\n'
			+ '\telse\n'
			+ '\t\tgone[#gone + 1] = KEYS[i]',
		);

		expect(scopedCacheCollectionIndexKeysPruneScript).toContain(
			"redis.call('SREM', KEYS[1], unpack(gone))",
		);
	});
});

describe('scanDeclaredIndexedEntries', () => {
	beforeEach(() => {
		for (const command of [
			scan,
			sscan,
			scopedCacheCollectionIndexKeysPrune,
			mget,
			exists,
		]) {
			command.mockReset();
		}
	});

	it(oneLine`
		reads the home pins' sets off the index-key set while a reap vouches for
		it
	`, async () => {
		mget.mockResolvedValueOnce(['7', '7']);

		sscan
			.mockResolvedValueOnce(['0', []])
			.mockResolvedValueOnce(['0', []])
			.mockResolvedValueOnce(['0', []])
			.mockResolvedValueOnce([
				'0',
				['scalabus:scoped-cache-index:fingerprint:slot:pin:id=7'],
			])
			.mockResolvedValueOnce(['0', ['slot:&id=,7,&|key-home']]);

		scopedCacheCollectionIndexKeysPrune.mockResolvedValueOnce([
			'scalabus:scoped-cache-index:fingerprint:slot:pin:id=7',
		]);

		const scanned = [];

		for await (const page of redisScopedCacheStore().scanDeclaredIndexedEntries(
			'slot',
			[{ collection: 'slot', pinnedScope: { name: ['ada'] } }],
			'name',
		)) {
			scanned.push(page);
		}

		expect(scanned).toEqual([[], [], [{
			fingerprint: { collection: 'slot', pinnedScope: { id: ['7'] } },
			key: 'key-home',
			location: {
				indexKey: 'scalabus:scoped-cache-index:fingerprint:slot:pin:id=7',
				member: 'slot:&id=,7,&|key-home',
			},
		}]]);

		expect(sscan.mock.calls).toEqual([
			['scalabus:scoped-cache-index:fingerprint:slot:bare', '0', 'COUNT', 1000],
			[
				'scalabus:scoped-cache-index:fingerprint:slot:name=ada',
				'0',
				'COUNT',
				1000,
			],
			['scalabus:scoped-cache-index:fingerprint:slot:', '0', 'COUNT', 1000],
			[
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'0',
				'MATCH',
				'scalabus:scoped-cache-index:fingerprint:slot:pin:*',
				'COUNT',
				1000,
			],
			[
				'scalabus:scoped-cache-index:fingerprint:slot:pin:id=7',
				'0',
				'COUNT',
				1000,
			],
		]);

		expect(scan).not.toHaveBeenCalled();
	});

	it(oneLine`
		scans the keyspace for the home pins' sets while no reap vouches for the
		index-key set
	`, async () => {
		mget.mockResolvedValueOnce([null, '7']);

		sscan
			.mockResolvedValueOnce(['0', []])
			.mockResolvedValueOnce(['0', []])
			.mockResolvedValueOnce(['0', []])
			.mockResolvedValueOnce(['0', ['slot:&id=,7,&|key-home']]);

		scan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:slot:pin:id=7'],
		]);

		const scanned = [];

		for await (const page of redisScopedCacheStore().scanDeclaredIndexedEntries(
			'slot',
			[{ collection: 'slot', pinnedScope: { name: ['ada'] } }],
			'name',
		)) {
			scanned.push(page);
		}

		expect(scanned).toEqual([[], [], [{
			fingerprint: { collection: 'slot', pinnedScope: { id: ['7'] } },
			key: 'key-home',
			location: {
				indexKey: 'scalabus:scoped-cache-index:fingerprint:slot:pin:id=7',
				member: 'slot:&id=,7,&|key-home',
			},
		}]]);

		expect(scan.mock.calls).toEqual([[
			'0',
			'MATCH',
			'scalabus:scoped-cache-index:fingerprint:slot:pin:*',
			'COUNT',
			1000,
		]]);

		expect(scopedCacheCollectionIndexKeysPrune).not.toHaveBeenCalled();
	});
});

describe('scanRowIndexedEntries', () => {
	beforeEach(() => {
		for (const command of [sscan, exists]) {
			command.mockReset();
		}
	});

	it(oneLine`
		reads the legacy bare set after the write's own sets until a reap has
		adopted the collection
	`, async () => {
		exists.mockResolvedValueOnce(0);

		sscan
			.mockResolvedValueOnce(['0', ['slot:&|key-a']])
			.mockResolvedValueOnce(['0', ['slot:&|key-a', 'slot:&id=,7,&|key-b']]);

		const scanned = [];

		for await (const page of redisScopedCacheStore().scanRowIndexedEntries(
			'slot',
			[],
			null,
		)) {
			scanned.push(page);
		}

		expect(scanned).toEqual([
			[{
				fingerprint: { collection: 'slot' },
				key: 'key-a',
				location: {
					indexKey: 'scalabus:scoped-cache-index:fingerprint:slot:bare',
					member: 'slot:&|key-a',
				},
			}],
			[{
				fingerprint: { collection: 'slot', pinnedScope: { id: ['7'] } },
				key: 'key-b',
				location: {
					indexKey: 'scalabus:scoped-cache-index:fingerprint:slot:',
					member: 'slot:&id=,7,&|key-b',
				},
			}],
		]);

		expect(exists.mock.calls).toEqual([
			['scalabus:scoped-cache-index:legacy-bare-adopted:slot'],
		]);

		expect(sscan.mock.calls).toEqual([
			['scalabus:scoped-cache-index:fingerprint:slot:bare', '0', 'COUNT', 1000],
			['scalabus:scoped-cache-index:fingerprint:slot:', '0', 'COUNT', 1000],
		]);
	});

	it('reads the legacy bare set when Redis cannot say it was adopted', async () => {
		exists.mockRejectedValueOnce(new Error('LOADING'));
		sscan.mockResolvedValue(['0', []]);

		for await (const _page of redisScopedCacheStore().scanRowIndexedEntries(
			'loose',
			[],
			null,
		)) {
			continue;
		}

		expect(sscan.mock.calls).toEqual([
			['scalabus:scoped-cache-index:fingerprint:loose:bare', '0', 'COUNT', 1000],
			['scalabus:scoped-cache-index:fingerprint:loose:', '0', 'COUNT', 1000],
		]);
	});

	it(oneLine`
		stops reading the legacy bare set once a reap adopted the collection, and
		stops asking
	`, async () => {
		exists.mockResolvedValueOnce(1);
		sscan.mockResolvedValue(['0', []]);

		for await (const _page of redisScopedCacheStore().scanRowIndexedEntries(
			'note',
			[],
			null,
		)) {
			continue;
		}

		for await (const _page of redisScopedCacheStore().scanRowIndexedEntries(
			'note',
			[],
			null,
		)) {
			continue;
		}

		expect(exists).toHaveBeenCalledTimes(1);

		expect(sscan.mock.calls).toEqual([
			['scalabus:scoped-cache-index:fingerprint:note:bare', '0', 'COUNT', 1000],
			['scalabus:scoped-cache-index:fingerprint:note:bare', '0', 'COUNT', 1000],
		]);
	});
});

describe('takeCollectionIndexedKeys', () => {
	beforeEach(() => {
		for (const command of [scan, sscan, evalScript, unlink, mget]) {
			command.mockReset();
		}
	});

	it(oneLine`
		moves the sets a keyspace scan finds while no reap vouches for the
		index-key set
	`, async () => {
		mget.mockResolvedValueOnce([null, '7']);
		evalScript.mockResolvedValue(['scalabus:scoped-cache-index:swept:slot:a1:1']);

		sscan
			.mockResolvedValueOnce(['0', []])
			.mockResolvedValueOnce(['0', ['slot:&name=,ada,&|key-ada']]);

		scan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:slot:name=ada'],
		]);

		const taken = [];

		for await (
			const take of redisScopedCacheStore().takeCollectionIndexedKeys('slot')
		) {
			taken.push(take);
		}

		expect(taken).toEqual([
			{ indexKeys: 0, keys: [], sweptKeys: [] },
			{
				indexKeys: 1,
				keys: ['key-ada'],
				sweptKeys: ['scalabus:scoped-cache-index:swept:slot:a1:1'],
			},
		]);

		expect(scan.mock.calls).toEqual([[
			'0',
			'MATCH',
			'scalabus:scoped-cache-index:fingerprint:slot:*',
			'COUNT',
			1000,
		]]);

		expect(sscan.mock.calls).toEqual([
			[
				'scalabus:scoped-cache-index:swept-index-keys',
				'0',
				'MATCH',
				'scalabus:scoped-cache-index:swept:slot:*',
				'COUNT',
				1000,
			],
			['scalabus:scoped-cache-index:swept:slot:a1:1', '0', 'COUNT', 1000],
		]);

		expect(evalScript.mock.calls).toEqual([[
			scopedCacheSweepMoveScript,
			3,
			'scalabus:scoped-cache-index:collection-index-keys:slot',
			'scalabus:scoped-cache-index:swept-index-keys',
			'scalabus:scoped-cache-index:fingerprint:slot:name=ada',
			expect.stringMatching(
				/^scalabus:scoped-cache-index:swept:slot:[0-9a-f-]{36}:$/,
			),
		]]);
	});

	it(oneLine`
		moves each index set aside, reads it in pages, and leaves it for the caller
		to release once its entries are gone
	`, async () => {
		evalScript.mockResolvedValue(['scalabus:scoped-cache-index:swept:slot:a1:1']);

		sscan
			.mockResolvedValueOnce(['0', []])
			.mockResolvedValueOnce([
				'0',
				['scalabus:scoped-cache-index:fingerprint:slot:bare'],
			])
			.mockResolvedValueOnce(['7', ['slot:&|key-a']])
			.mockResolvedValueOnce(['0', ['slot:&owner=,kappa,&|key-b']]);

		const taken = [];

		for await (
			const take of redisScopedCacheStore().takeCollectionIndexedKeys('slot')
		) {
			taken.push(take);
		}

		expect(taken).toEqual([
			{ indexKeys: 0, keys: [], sweptKeys: [] },
			{
				indexKeys: 1,
				keys: ['key-a', 'key-b'],
				sweptKeys: ['scalabus:scoped-cache-index:swept:slot:a1:1'],
			},
		]);

		expect(scan).not.toHaveBeenCalled();

		expect(evalScript).toHaveBeenCalledWith(
			scopedCacheSweepMoveScript,
			3,
			'scalabus:scoped-cache-index:collection-index-keys:slot',
			'scalabus:scoped-cache-index:swept-index-keys',
			'scalabus:scoped-cache-index:fingerprint:slot:bare',
			expect.stringMatching(
				/^scalabus:scoped-cache-index:swept:slot:[0-9a-f-]{36}:$/,
			),
		);

		expect(sscan.mock.calls).toEqual([
			[
				'scalabus:scoped-cache-index:swept-index-keys',
				'0',
				'MATCH',
				'scalabus:scoped-cache-index:swept:slot:*',
				'COUNT',
				1000,
			],
			[
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'0',
				'COUNT',
				1000,
			],
			['scalabus:scoped-cache-index:swept:slot:a1:1', '0', 'COUNT', 1000],
			['scalabus:scoped-cache-index:swept:slot:a1:1', '7', 'COUNT', 1000],
		]);

		// Dropped before its entries, a set leaves them cached and named by nothing
		// when the entry drop fails.
		expect(unlink).not.toHaveBeenCalled();
	});

	it(oneLine`
		reads the sets an earlier sweep of the collection moved aside and never
		released, without moving them again
	`, async () => {
		sscan
			.mockResolvedValueOnce([
				'0',
				['scalabus:scoped-cache-index:swept:slot:dead:1'],
			])
			.mockResolvedValueOnce(['0', ['slot:&|key-left']])
			.mockResolvedValueOnce(['0', []]);

		const taken = [];

		for await (
			const take of redisScopedCacheStore().takeCollectionIndexedKeys('slot')
		) {
			taken.push(take);
		}

		expect(taken).toEqual([
			{
				indexKeys: 1,
				keys: ['key-left'],
				sweptKeys: ['scalabus:scoped-cache-index:swept:slot:dead:1'],
			},
			{ indexKeys: 0, keys: [], sweptKeys: [] },
		]);

		expect(evalScript).not.toHaveBeenCalled();
	});

	it(oneLine`
		takes the keys of a read filed only under a home pin, off the set the
		index-key set names, without a keyspace scan
	`, async () => {
		evalScript.mockResolvedValue(['scalabus:scoped-cache-index:swept:slot:a1:1']);

		sscan
			.mockResolvedValueOnce(['0', []])
			.mockResolvedValueOnce([
				'0',
				['scalabus:scoped-cache-index:fingerprint:slot:pin:id=7'],
			])
			.mockResolvedValueOnce(['0', ['slot:&id=,7,&|key-home']]);

		const taken = [];

		for await (
			const take of redisScopedCacheStore().takeCollectionIndexedKeys('slot')
		) {
			taken.push(take);
		}

		expect(taken).toEqual([
			{ indexKeys: 0, keys: [], sweptKeys: [] },
			{
				indexKeys: 1,
				keys: ['key-home'],
				sweptKeys: ['scalabus:scoped-cache-index:swept:slot:a1:1'],
			},
		]);

		expect(evalScript).toHaveBeenCalledWith(
			scopedCacheSweepMoveScript,
			3,
			'scalabus:scoped-cache-index:collection-index-keys:slot',
			'scalabus:scoped-cache-index:swept-index-keys',
			'scalabus:scoped-cache-index:fingerprint:slot:pin:id=7',
			expect.stringMatching(
				/^scalabus:scoped-cache-index:swept:slot:[0-9a-f-]{36}:$/,
			),
		);

		expect(scan).not.toHaveBeenCalled();
	});

	it(oneLine`
		counts only the sets it moved, not the names whose set is already gone
	`, async () => {
		evalScript.mockResolvedValue(['scalabus:scoped-cache-index:swept:slot:a1:1']);

		sscan
			.mockResolvedValueOnce(['0', []])
			.mockResolvedValueOnce([
				'0',
				[
					'scalabus:scoped-cache-index:fingerprint:slot:name=ada',
					'scalabus:scoped-cache-index:fingerprint:slot:name=gone',
				],
			])
			.mockResolvedValueOnce(['0', ['slot:&name=,ada,&|key-ada']]);

		const taken = [];

		for await (
			const take of redisScopedCacheStore().takeCollectionIndexedKeys('slot')
		) {
			taken.push(take);
		}

		expect(taken).toEqual([
			{ indexKeys: 0, keys: [], sweptKeys: [] },
			{
				indexKeys: 1,
				keys: ['key-ada'],
				sweptKeys: ['scalabus:scoped-cache-index:swept:slot:a1:1'],
			},
		]);
	});

	it('gives a moved set no expiry of its own: it keeps the one it had', () => {
		expect(scopedCacheSweepMoveScript).not.toContain('EXPIRE');
	});

	// Split into separate steps, a sweep dying between them leaves a set holding
	// members that neither index-key set names, so no purge or recovery reaches it.
	it(oneLine`
		moves a set, names it in the swept index-key set and drops its name from the
		collection's index-key set in one script
	`, () => {
		expect(scopedCacheSweepMoveScript).toContain(
			"\t\tredis.call('RENAME', KEYS[i], sweptKey)\n"
			+ "\t\tredis.call('SADD', KEYS[2], sweptKey)\n"
			+ '\t\tmoved[#moved + 1] = sweptKey\n'
			+ '\tend\n'
			+ "\tredis.call('SREM', KEYS[1], KEYS[i])",
		);
	});
});

describe('takeStrandedSweptIndexKeys', () => {
	beforeEach(() => {
		for (const command of [scan, sscan, evalScript, unlink]) {
			command.mockReset();
		}
	});

	afterEach(() => {
		env['CACHE_NAMESPACE'] = 'scalabus';
	});

	it(oneLine`
		escapes the namespace in the swept pattern: a namespace holding glob
		characters would otherwise match the sets of every namespace it spells
	`, async () => {
		env['CACHE_NAMESPACE'] = 'tenant-[a]*';
		sscan.mockResolvedValueOnce(['0', []]);

		await redisScopedCacheStore()
			.takeCollectionIndexedKeys('slot')
			.next();

		expect(sscan.mock.calls).toEqual([[
			'tenant-[a]*:scoped-cache-index:swept-index-keys',
			'0',
			'MATCH',
			'tenant-\\[a\\]\\*:scoped-cache-index:swept:slot:*',
			'COUNT',
			1000,
		]]);
	});

	it(oneLine`
		reads every set a sweep moved aside and never released, whichever
		collection it swept, without moving or dropping anything
	`, async () => {
		sscan
			.mockResolvedValueOnce([
				'0',
				[
					'scalabus:scoped-cache-index:swept:slot:dead:1',
					'scalabus:scoped-cache-index:swept:note:dead:1',
				],
			])
			.mockResolvedValueOnce(['0', ['slot:&|key-slot']])
			.mockResolvedValueOnce(['0', ['note:&|key-note']]);

		const taken = [];

		for await (
			const take of redisScopedCacheStore().takeStrandedSweptIndexKeys()
		) {
			taken.push(take);
		}

		expect(taken).toEqual([{
			indexKeys: 2,
			keys: ['key-slot', 'key-note'],
			sweptKeys: [
				'scalabus:scoped-cache-index:swept:slot:dead:1',
				'scalabus:scoped-cache-index:swept:note:dead:1',
			],
		}]);

		expect(sscan.mock.calls[0]).toEqual([
			'scalabus:scoped-cache-index:swept-index-keys',
			'0',
			'COUNT',
			1000,
		]);

		expect(scan).not.toHaveBeenCalled();
		expect(evalScript).not.toHaveBeenCalled();
		expect(unlink).not.toHaveBeenCalled();
	});
});

describe('reapIndexedEntries', () => {
	beforeEach(() => {
		for (const command of [
			scan,
			sscan,
			defineCommand,
			scopedCacheIndexReap,
			scopedCacheLegacyBareAdopt,
			scopedCacheCollectionIndexKeysRegister,
			scopedCacheCollectionIndexKeysPrune,
			pttl,
			sadd,
			get,
			set,
		]) {
			command.mockReset();
		}

		pttl.mockResolvedValue(-2);
	});

	it(oneLine`
		marks the index-key sets complete with the wholesale counter it read before
		its scan, once the pass ends
	`, async () => {
		get.mockResolvedValueOnce('41');

		scan
			.mockResolvedValueOnce(['3', []])
			.mockResolvedValueOnce(['0', []]);

		await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(get.mock.calls).toEqual([['scalabus:scoped-cache-epoch:*']]);

		expect(set.mock.calls).toEqual([[
			'scalabus:scoped-cache-index:collection-index-keys-complete',
			'41',
		]]);

		expect(get.mock.invocationCallOrder[0])
			.toBeLessThan(scan.mock.invocationCallOrder[0]!);

		expect(set.mock.invocationCallOrder[0])
			.toBeGreaterThan(scan.mock.invocationCallOrder[1]!);
	});

	it('marks them complete with an empty value when no counter exists', async () => {
		get.mockResolvedValueOnce(null);
		scan.mockResolvedValueOnce(['0', []]);

		await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(set.mock.calls).toEqual([[
			'scalabus:scoped-cache-index:collection-index-keys-complete',
			'',
		]]);
	});

	// A pass cut short may have left a set unnamed: marking it complete would
	// let a collection-wide purge miss that set's reads.
	it('leaves the marker as it was when the pass throws', async () => {
		get.mockResolvedValueOnce('41');

		scan
			.mockResolvedValueOnce([
				'3',
				['scalabus:scoped-cache-index:fingerprint:slot:bare'],
			])
			.mockRejectedValueOnce(new Error('LOADING'));

		sscan.mockResolvedValueOnce(['0', []]);

		await expect(redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		)).rejects.toThrow('LOADING');

		expect(set).not.toHaveBeenCalled();
	});

	it(oneLine`
		asks one script per set to remove the members whose entry is gone, and
		to bump the counter of the set's collection
	`, async () => {
		scan.mockResolvedValueOnce([
			'0',
			[
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
				'scalabus:scoped-cache-index:fingerprint:note:owner=ana',
			],
		]);

		sscan
			.mockResolvedValueOnce(['0', ['slot:&|key-a', 'slot:&|key-b']])
			.mockResolvedValueOnce(['0', ['note:&owner=,ana,&|key-c']]);

		scopedCacheIndexReap
			.mockResolvedValueOnce(1)
			.mockResolvedValueOnce(0);

		const tally = await redisScopedCacheStore().reapIndexedEntries(
			(key) => `raw:${key}`,
			(collection) => `scalabus:scoped-cache-epoch:${collection}`,
			86400,
		);

		expect(tally).toEqual({ indexKeys: 2, reaped: 1, strandedSweptKeys: 0 });

		expect(defineCommand).toHaveBeenCalledWith(
			'scopedCacheIndexReap',
			{ numberOfKeys: 2, lua: scopedCacheIndexReapScript },
		);

		expect(scan.mock.calls).toEqual([[
			'0',
			'MATCH',
			'scalabus:scoped-cache-index:*',
			'COUNT',
			1000,
		]]);

		expect(scopedCacheIndexReap.mock.calls).toEqual([
			[
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
				'scalabus:scoped-cache-epoch:slot',
				86400,
				'slot:&|key-a',
				'raw:key-a',
				'slot:&|key-b',
				'raw:key-b',
			],
			[
				'scalabus:scoped-cache-index:fingerprint:note:owner=ana',
				'scalabus:scoped-cache-epoch:note',
				86400,
				'note:&owner=,ana,&|key-c',
				'raw:key-c',
			],
		]);
	});

	it(oneLine`
		reads a set page by page, and sends a page of more than 500 members in
		chunks of 500
	`, async () => {
		scan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:slot:bare'],
		]);

		const members = Array.from({ length: 501 }, (_, at) => `slot:&|key-${at}`);

		sscan
			.mockResolvedValueOnce(['7', members])
			.mockResolvedValueOnce(['0', ['slot:&|key-last']]);

		scopedCacheIndexReap.mockResolvedValue(0);

		await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(sscan.mock.calls).toEqual([
			['scalabus:scoped-cache-index:fingerprint:slot:bare', '0', 'COUNT', 1000],
			['scalabus:scoped-cache-index:fingerprint:slot:bare', '7', 'COUNT', 1000],
		]);

		expect(scopedCacheIndexReap).toHaveBeenCalledTimes(3);
		expect(scopedCacheIndexReap.mock.calls[0]).toHaveLength(1003);

		expect(scopedCacheIndexReap.mock.calls[1]).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:bare',
			'slot',
			86400,
			'slot:&|key-500',
			'key-500',
		]);

		expect(scopedCacheIndexReap.mock.calls[2]).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:bare',
			'slot',
			86400,
			'slot:&|key-last',
			'key-last',
		]);
	});

	it('leaves a member naming no key alone', async () => {
		scan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:slot:bare'],
		]);

		sscan.mockResolvedValueOnce(['0', ['slot:&']]);

		const tally = await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(tally).toEqual({ indexKeys: 1, reaped: 0, strandedSweptKeys: 0 });
		expect(scopedCacheIndexReap).not.toHaveBeenCalled();
	});

	it(oneLine`
		names each set it reads in its collection's index-key set with the set's own
		expiry, so a set filed by a node without the index-key set is found again
	`, async () => {
		scan.mockResolvedValueOnce([
			'0',
			[
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
				'scalabus:scoped-cache-index:fingerprint:note:bare',
			],
		]);

		sscan
			.mockResolvedValueOnce(['0', ['slot:&|key-a']])
			.mockResolvedValueOnce(['0', ['note:&|key-b']]);

		pttl
			.mockResolvedValueOnce(5000)
			.mockResolvedValueOnce(-1);

		scopedCacheIndexReap.mockResolvedValue(0);

		await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(scopedCacheCollectionIndexKeysRegister.mock.calls).toEqual([
			[
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				5000,
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
			],
			[
				'scalabus:scoped-cache-index:collection-index-keys:note',
				-1,
				'scalabus:scoped-cache-index:fingerprint:note:bare',
			],
		]);
	});

	it(oneLine`
		names a home pin's set filed by a node without the index-key set in the
		collection's index-key set
	`, async () => {
		scan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:slot:pin:id=7'],
		]);

		sscan.mockResolvedValueOnce(['0', ['slot:&id=,7,&|key-a']]);
		pttl.mockResolvedValueOnce(5000);
		scopedCacheIndexReap.mockResolvedValue(0);

		await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(scopedCacheCollectionIndexKeysRegister.mock.calls).toEqual([[
			'scalabus:scoped-cache-index:collection-index-keys:slot',
			5000,
			'scalabus:scoped-cache-index:fingerprint:slot:pin:id=7',
		]]);
	});

	it('names nothing for a set gone by the end of its read', async () => {
		scan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:slot:bare'],
		]);

		sscan.mockResolvedValueOnce(['0', ['slot:&|key-a']]);
		scopedCacheIndexReap.mockResolvedValue(1);

		await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(scopedCacheCollectionIndexKeysRegister).not.toHaveBeenCalled();
	});

	it(oneLine`
		prunes the index-key sets it meets instead of reaping them as index sets
	`, async () => {
		scan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:collection-index-keys:slot'],
		]);

		sscan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:slot:owner=gone'],
		]);

		scopedCacheCollectionIndexKeysPrune.mockResolvedValueOnce([]);

		const tally = await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(tally).toEqual({ indexKeys: 0, reaped: 0, strandedSweptKeys: 0 });

		// The pattern the index-key sets have to match for Redis to return them.
		expect(scan.mock.calls).toEqual([[
			'0',
			'MATCH',
			'scalabus:scoped-cache-index:*',
			'COUNT',
			1000,
		]]);

		expect(sscan.mock.calls).toEqual([[
			'scalabus:scoped-cache-index:collection-index-keys:slot',
			'0',
			'COUNT',
			1000,
		]]);

		expect(scopedCacheCollectionIndexKeysPrune.mock.calls).toEqual([[
			2,
			'scalabus:scoped-cache-index:collection-index-keys:slot',
			'scalabus:scoped-cache-index:fingerprint:slot:owner=gone',
		]]);

		expect(scopedCacheIndexReap).not.toHaveBeenCalled();
		expect(sadd).not.toHaveBeenCalled();
	});

	it(oneLine`
		names the moved sets it meets in the swept index-key set, counting only the
		names that were missing, and reads none of them
	`, async () => {
		scan.mockResolvedValueOnce([
			'0',
			[
				'scalabus:scoped-cache-index:swept:slot:4f1c:1',
				'scalabus:scoped-cache-index:swept:slot:4f1c:2',
				'scalabus:scoped-cache-index:swept-index-keys',
			],
		]);

		sadd.mockResolvedValueOnce(1);

		const tally = await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(tally).toEqual({ indexKeys: 0, reaped: 0, strandedSweptKeys: 1 });

		expect(sadd.mock.calls).toEqual([[
			'scalabus:scoped-cache-index:swept-index-keys',
			[
				'scalabus:scoped-cache-index:swept:slot:4f1c:1',
				'scalabus:scoped-cache-index:swept:slot:4f1c:2',
			],
		]]);

		expect(sscan).not.toHaveBeenCalled();
		expect(scopedCacheIndexReap).not.toHaveBeenCalled();
	});

	// A fill files its members before it writes its entry: the bump is what makes
	// one caught between the two evict the entry this unnamed.
	it('bumps the counter in the same script as the removal', () => {
		expect(scopedCacheIndexReapScript).toContain(
			"if redis.call('EXISTS', ARGV[i + 1]) == 0 then",
		);

		expect(scopedCacheIndexReapScript).toContain(
			"redis.call('SET', KEYS[2], seed, 'NX')\n"
			+ "redis.call('INCR', KEYS[2])\n"
			+ "redis.call('EXPIRE', KEYS[2], ARGV[1])\n"
			+ "redis.call('SREM', KEYS[1], unpack(gone))",
		);
	});

	it(oneLine`
		adopts a legacy bare set page by page once each page is reaped, naming
		every set a member can be in beside it, and marks it on the last call
	`, async () => {
		scan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:slot:'],
		]);

		sscan
			.mockResolvedValueOnce(['7', ['slot:&id=,7,&|key-a']])
			.mockResolvedValueOnce(['0', ['slot:&|key-b']]);

		scopedCacheIndexReap.mockResolvedValue(0);

		await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(defineCommand).toHaveBeenCalledWith(
			'scopedCacheLegacyBareAdopt',
			{ numberOfKeys: 4, lua: scopedCacheLegacyBareAdoptScript },
		);

		expect(scopedCacheLegacyBareAdopt.mock.calls).toEqual([
			[
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
				'scalabus:scoped-cache-index:fingerprint:slot:',
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'scalabus:scoped-cache-index:legacy-bare-adopted:slot',
				0,
				'slot:&id=,7,&|key-a',
				2,
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
				'scalabus:scoped-cache-index:fingerprint:slot:pin:id=7',
			],
			[
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
				'scalabus:scoped-cache-index:fingerprint:slot:',
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'scalabus:scoped-cache-index:legacy-bare-adopted:slot',
				1,
				'slot:&|key-b',
				1,
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
			],
		]);

		expect(scopedCacheIndexReap.mock.invocationCallOrder[0])
			.toBeLessThan(scopedCacheLegacyBareAdopt.mock.invocationCallOrder[0]!);
	});

	it('marks a legacy bare set adopted when its last page is empty', async () => {
		scan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:slot:'],
		]);

		sscan
			.mockResolvedValueOnce(['7', ['slot:&|key-a']])
			.mockResolvedValueOnce(['0', []]);

		scopedCacheIndexReap.mockResolvedValue(0);

		await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(scopedCacheLegacyBareAdopt.mock.calls).toEqual([
			[
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
				'scalabus:scoped-cache-index:fingerprint:slot:',
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'scalabus:scoped-cache-index:legacy-bare-adopted:slot',
				0,
				'slot:&|key-a',
				1,
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
			],
			[
				'scalabus:scoped-cache-index:fingerprint:slot:bare',
				'scalabus:scoped-cache-index:fingerprint:slot:',
				'scalabus:scoped-cache-index:collection-index-keys:slot',
				'scalabus:scoped-cache-index:legacy-bare-adopted:slot',
				1,
			],
		]);
	});

	it('adopts nothing from the bare set, whose members are its own', async () => {
		scan.mockResolvedValueOnce([
			'0',
			['scalabus:scoped-cache-index:fingerprint:slot:bare'],
		]);

		sscan.mockResolvedValueOnce(['0', ['slot:&|key-a']]);
		scopedCacheIndexReap.mockResolvedValue(0);

		await redisScopedCacheStore().reapIndexedEntries(
			(key) => key,
			(collection) => collection,
			86400,
		);

		expect(scopedCacheLegacyBareAdopt).not.toHaveBeenCalled();
	});
});

describe('scopedCacheLegacyBareAdoptScript', () => {
	// A member this build filed sits in its own set too; filing it bare would put
	// it in the one set every write reads whole.
	it(oneLine`
		files only a member still in the legacy bare set and in none of the sets
		it can be in
	`, () => {
		expect(scopedCacheLegacyBareAdoptScript).toContain(
			"local skipped = redis.call('SISMEMBER', KEYS[2], ARGV[at]) == 0\n"
			+ '\tfor i = at + 2, at + count + 1 do\n'
			+ "\t\tskipped = skipped or redis.call('SISMEMBER', ARGV[i], ARGV[at]) == 1",
		);
	});

	it(oneLine`
		names the bare set and moves the index-key set's expiry before filing into
		it
	`, () => {
		expect(scopedCacheLegacyBareAdoptScript).toContain(
			"redis.call('SADD', KEYS[3], KEYS[1])\n"
			+ '\tif want == -1 then\n'
			+ '\t\tif namedLeft >= 0 then\n'
			+ "\t\t\tredis.call('PERSIST', KEYS[3])\n"
			+ '\t\tend\n'
			+ '\telseif namedLeft == -2 or (namedLeft >= 0 and namedLeft < want) then\n'
			+ "\t\tredis.call('PEXPIRE', KEYS[3], want)\n"
			+ '\tend\n'
			+ "\tredis.call('SADD', KEYS[1], unpack(adopted))",
		);
	});

	it('writes the adopted marker only on the call that ends the pass', () => {
		expect(scopedCacheLegacyBareAdoptScript).toContain(
			"if ARGV[1] == '1' then\n"
			+ "\tredis.call('SET', KEYS[4], '1')",
		);
	});
});

describe('releaseSweptIndexKeys', () => {
	beforeEach(() => {
		unlink.mockReset();
		srem.mockReset();
	});

	it(oneLine`
		drops the sets a take moved aside, then their names from the swept
		index-key set
	`, async () => {
		await redisScopedCacheStore().releaseSweptIndexKeys([
			'scalabus:scoped-cache-index:swept:slot:a1:1',
		]);

		expect(unlink.mock.calls).toEqual([
			[['scalabus:scoped-cache-index:swept:slot:a1:1']],
		]);

		expect(srem.mock.calls).toEqual([[
			'scalabus:scoped-cache-index:swept-index-keys',
			['scalabus:scoped-cache-index:swept:slot:a1:1'],
		]]);

		// Named no more while still held, the set's entries are reached by nothing.
		expect(unlink.mock.invocationCallOrder[0])
			.toBeLessThan(srem.mock.invocationCallOrder[0]!);
	});

	// A set still held once its name is gone holds entries nothing reaches again,
	// so a refused delete keeps every name for the recovery.
	it(oneLine`
		keeps every name in the swept index-key set when a delete is refused
	`, async () => {
		pipelineExec.mockResolvedValueOnce([
			[new Error('OOM command not allowed'), null],
		]);

		expect(await redisScopedCacheStore().releaseSweptIndexKeys([
			'scalabus:scoped-cache-index:swept:slot:a1:1',
		])).toEqual({ dropped: 0, refused: 1 });

		expect(srem).not.toHaveBeenCalled();
	});
});

describe('onStoreReady', () => {
	afterEach(() => {
		onEvent.mockReset();
		redisState.status = 'connecting';
	});

	it(oneLine`
		runs the listener at once on a connection already up: the boot uses the
		client before the recovery registers, so that first ready has fired
	`, () => {
		redisState.status = 'ready';
		const listener = vi.fn();

		redisScopedCacheStore().onStoreReady(listener);

		expect(listener).toHaveBeenCalledTimes(1);
		expect(onEvent).toHaveBeenCalledWith('ready', listener);
	});

	it('waits for the ready of a connection still coming up', () => {
		const listener = vi.fn();

		redisScopedCacheStore().onStoreReady(listener);

		expect(listener).not.toHaveBeenCalled();
		expect(onEvent).toHaveBeenCalledWith('ready', listener);
	});
});
