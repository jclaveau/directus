import { oneLine } from '@directus/utils';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	parseScopedCacheIndexMember,
	redisScopedCacheStore,
	renderScopedCacheIndexMember,
	scopedCacheEpochBumpScript,
	scopedCacheFingerprintIndexKeys,
	scopedCacheRowIndexGlobs,
	scopedCacheRowIndexKeys,
} from './redis-store.js';
import { parseScopedCacheFingerprint } from './fingerprint.js';

vi.mock('@directus/env', () => {
	return { useEnv: () => ({ CACHE_NAMESPACE: 'scalabus' }) };
});

const srem = vi.fn();
const defineCommand = vi.fn();
const scopedCacheEpochBump = vi.fn();

vi.mock('../redis/index.js', () => {
	return {
		useRedis: () => {
			return {
				defineCommand,
				scopedCacheEpochBump,
				pipeline: () => ({ srem, exec: async () => [] }),
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
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:zone.region.owner=ana',
		]);
	});

	it('files a read bounded to a list of values under each of them', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('slot:&zone.region.owner=,ana,bo,&'),
			'zone.region.owner',
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:zone.region.owner=ana',
			'scalabus:scoped-cache-index:fingerprint:slot:zone.region.owner=bo',
		]);
	});

	it('files a read pinning every axis but the index path bare', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('slot:&method=,spaced,&view=,id,&'),
			'zone.region.owner',
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:slot:']);
	});

	it('files every read of a collection with no index path bare', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('loose:&view=,id,&'),
			null,
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:loose:']);
	});

	it('escapes a value carrying a separator, so its set is its own', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('slot:&zone.region.owner=,a\\,b,&'),
			'zone.region.owner',
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
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:slot:']);
	});

	it('files a read under an index path named after an object member', () => {
		expect(scopedCacheFingerprintIndexKeys(
			parseScopedCacheFingerprint('slot:&constructor=,ana,&'),
			'constructor',
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:slot:constructor=ana']);
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
			'scalabus:scoped-cache-index:fingerprint:slot:',
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
			'scalabus:scoped-cache-index:fingerprint:slot:',
			'scalabus:scoped-cache-index:fingerprint:slot:zone.region.owner=ana',
		]);
	});

	it('reads the bare set alone for a row whose index value never resolved', () => {
		expect(scopedCacheRowIndexKeys(
			'slot',
			[parseScopedCacheFingerprint('slot:&id=,1,&')],
			'zone.region.owner',
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:slot:']);
	});

	// A collection may declare a column named after an Object member, and the
	// index path is looked up by column name.
	it('reads the bare set alone for a row pinning nothing, on any path', () => {
		expect(scopedCacheRowIndexKeys(
			'slot',
			[{ collection: 'slot' }],
			'constructor',
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:slot:']);
	});

	it('reads the set of an index path named after an object member', () => {
		expect(scopedCacheRowIndexKeys(
			'slot',
			[parseScopedCacheFingerprint('slot:&constructor=,ana,&')],
			'constructor',
		)).toEqual([
			'scalabus:scoped-cache-index:fingerprint:slot:',
			'scalabus:scoped-cache-index:fingerprint:slot:constructor=ana',
		]);
	});

	it('reads the bare set alone for a collection with no index path', () => {
		expect(scopedCacheRowIndexKeys(
			'loose',
			[parseScopedCacheFingerprint('loose:&id=,1,&')],
			null,
		)).toEqual(['scalabus:scoped-cache-index:fingerprint:loose:']);
	});

	it('names the bare set even when the write carried no row', () => {
		expect(scopedCacheRowIndexKeys('slot', [], 'zone.region.owner'))
			.toEqual(['scalabus:scoped-cache-index:fingerprint:slot:']);
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

describe('scopedCacheRowIndexGlobs', () => {
	it('names one pattern per pin the row carries, and the two that pin none', () => {
		expect(scopedCacheRowIndexGlobs('slot', [
			parseScopedCacheFingerprint('slot:&id=,1,&owner=,alpha,&'),
		])).toEqual([
			'slot:&|*',
			'slot:&view=,*',
			'slot:*&id=*,1,*',
			'slot:*&owner=*,alpha,*',
		]);
	});

	it('names each value of a multi-valued pin, once across the batch', () => {
		expect(scopedCacheRowIndexGlobs('slot', [
			parseScopedCacheFingerprint('slot:&owner=,alpha,&'),
			parseScopedCacheFingerprint('slot:&owner=,beta,&'),
			parseScopedCacheFingerprint('slot:&owner=,alpha,&'),
		])).toEqual([
			'slot:&|*',
			'slot:&view=,*',
			'slot:*&owner=*,alpha,*',
			'slot:*&owner=*,beta,*',
		]);
	});

	it('names a field called view by its escaped key, not the view\'s', () => {
		expect(scopedCacheRowIndexGlobs('note', [
			{ collection: 'note', pinnedScope: { view: ['7'] } },
		])).toEqual([
			'note:&|*',
			'note:&view=,*',
			'note:*&\\\\view=*,7,*',
		]);
	});

	// The value is stored escaped (`a\*b`), and a glob eats a backslash rather than
	// matching one, so the pattern doubles what the serialiser wrote.
	it('escapes a value carrying a glob metacharacter', () => {
		expect(scopedCacheRowIndexGlobs('slot', [
			{ collection: 'slot', pinnedScope: { owner: ['a*b'] } },
		])).toEqual([
			'slot:&|*',
			'slot:&view=,*',
			'slot:*&owner=*,a\\\\\\*b,*',
		]);
	});

	it('escapes a value carrying a separator', () => {
		expect(scopedCacheRowIndexGlobs('slot', [
			{ collection: 'slot', pinnedScope: { owner: ['a,b'] } },
		])).toEqual([
			'slot:&|*',
			'slot:&view=,*',
			'slot:*&owner=*,a\\\\,b,*',
		]);
	});

	it(oneLine`
		reads the sets whole for a collection its escapes respell, so a member
		filed under the raw name is still tested
	`, () => {
		expect(scopedCacheRowIndexGlobs('a*b', [
			{ collection: 'a*b', pinnedScope: { owner: ['alpha'] } },
		])).toBe(null);
	});

	it(oneLine`
		gives up on filtering past the bound, so a wide batch reads its sets whole
		instead of walking them once per slice
	`, () => {
		const rowFingerprints = Array.from({ length: 65 }, (_value, at) => {
			return { collection: 'slot', pinnedScope: { id: [`${at}`] } };
		});

		expect(scopedCacheRowIndexGlobs('slot', rowFingerprints)).toBe(null);
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
		prunes only where it found a member, where no index path names the sets it
		would otherwise be in
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
