import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import { describe, expect, it, vi } from 'vitest';
import {
	parseScopedCacheIndexMember,
	renderScopedCacheIndexMember,
	scopedCacheFingerprintIndexKeys,
	scopedCacheIndexPath,
	scopedCacheRowIndexKeys,
} from './fingerprint-index.js';
import { parseScopedCacheFingerprint } from './fingerprint.js';

vi.mock('@directus/env', () => {
	return { useEnv: () => ({ CACHE_NAMESPACE: 'scalabus' }) };
});

// `slot` owns through `zone`, which owns through `region`, so its index path is
// two hops deep and the walk has a longest path to prefer. `note` scopes on a flat
// column alone, so it has no ancestor to index by.
const schema = new SchemaBuilder()
	.collection('slot', (c) => {
		c.field('id').id();
		c.field('method').string();
		c.field('zone').m2o('zone');
	})
	.collection('zone', (c) => {
		c.field('id').id();
		c.field('region').m2o('region');
	})
	.collection('region', (c) => {
		c.field('id').id();
		c.field('owner').string();
	})
	.collection('note', (c) => {
		c.field('id').id();
		c.field('method').string();
		c.field('author').string();
	})
	.collection('loose', (c) => {
		c.field('id').id();
	})
	.build();

schema.collections['slot']!.scopedCacheFields = ['method', 'zone'];
schema.collections['zone']!.scopedCacheFields = ['region'];
schema.collections['region']!.scopedCacheFields = ['owner'];
schema.collections['note']!.scopedCacheFields = ['method', 'author'];

describe('scopedCacheIndexPath', () => {
	it('follows the index path to its deepest ancestor key', () => {
		expect(scopedCacheIndexPath(schema, 'slot')).toBe('zone.region.owner');
	});

	it('stops at the ancestor a shorter chain reaches', () => {
		expect(scopedCacheIndexPath(schema, 'zone')).toBe('region.owner');
	});

	it(oneLine`
		falls back to the first field a collection scoping only on its own columns
		declares
	`, () => {
		expect(scopedCacheIndexPath(schema, 'note')).toBe('method');
	});

	it('has no path for a collection declaring no scope at all', () => {
		expect(scopedCacheIndexPath(schema, 'loose')).toBe(null);
	});
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
			{ collection: 'slot', pinnedScope: {}, viewFields: [] },
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
			[{ collection: 'slot', pinnedScope: {}, viewFields: [] }],
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

	it('reads a member holding no key as a fingerprint alone', () => {
		expect(parseScopedCacheIndexMember('slot:&'))
			.toEqual({ fingerprint: parseScopedCacheFingerprint('slot:&'), key: '' });
	});
});
