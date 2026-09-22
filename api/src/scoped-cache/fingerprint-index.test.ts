import { SchemaBuilder } from '@directus/schema-builder';
import { oneLine } from '@directus/utils';
import { describe, expect, it, vi } from 'vitest';
import {
	parseScopedCacheIndexMember,
	renderScopedCacheIndexMember,
	scopedCacheFingerprintBuckets,
	scopedCacheFingerprintIndexKey,
	scopedCacheBucketPath,
	scopedCacheRowBuckets,
} from './fingerprint-index.js';

vi.mock('@directus/env', () => {
	return { useEnv: () => ({ CACHE_NAMESPACE: 'scalabus' }) };
});

// `slot` owns through `zone`, which owns through `region`, so its bucket path
// is two hops deep and the bucket has a longest path to prefer. `note` scopes on a
// flat column alone, so it has no ancestor to bucket by.
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

describe('scopedCacheFingerprintIndexKey', () => {
	it('names the set by its collection and bucket, under the index prefix', () => {
		expect(scopedCacheFingerprintIndexKey('slot', 'zone.region.owner=ana'))
			.toBe('scalabus:scoped-cache-index:idx:slot:zone.region.owner=ana');
	});

	it('names the bare set by its collection alone', () => {
		expect(scopedCacheFingerprintIndexKey('slot', ''))
			.toBe('scalabus:scoped-cache-index:idx:slot:');
	});
});

describe('scopedCacheBucketPath', () => {
	it('follows the bucket path to its deepest ancestor key', () => {
		expect(scopedCacheBucketPath(schema, 'slot')).toBe('zone.region.owner');
	});

	it('stops at the ancestor a shorter chain reaches', () => {
		expect(scopedCacheBucketPath(schema, 'zone')).toBe('region.owner');
	});

	it(oneLine`
		falls back to the first field a collection scoping only on its own columns
		declares
	`, () => {
		expect(scopedCacheBucketPath(schema, 'note')).toBe('method');
	});

	it('has no path for a collection declaring no scope at all', () => {
		expect(scopedCacheBucketPath(schema, 'loose')).toBe(null);
	});
});

describe('scopedCacheFingerprintBuckets', () => {
	it('files a read under the bucket value it pinned', () => {
		expect(scopedCacheFingerprintBuckets(
			'slot:&fields=,id,&method=,spaced,&zone.region.owner=,ana,&',
			'zone.region.owner',
		)).toEqual(['zone.region.owner=ana']);
	});

	it('files a read bounded to a list of bucket values under each of them', () => {
		expect(scopedCacheFingerprintBuckets(
			'slot:&zone.region.owner=,ana,bo,&',
			'zone.region.owner',
		)).toEqual(['zone.region.owner=ana', 'zone.region.owner=bo']);
	});

	it('files a read pinning every axis but the bucket value bare', () => {
		expect(scopedCacheFingerprintBuckets(
			'slot:&fields=,id,&method=,spaced,&',
			'zone.region.owner',
		)).toEqual(['']);
	});

	it('files every read of a collection with no bucket path bare', () => {
		expect(scopedCacheFingerprintBuckets('loose:&fields=,id,&', null))
			.toEqual(['']);
	});

	it('escapes a bucket value carrying a separator, so its set is its own', () => {
		expect(scopedCacheFingerprintBuckets(
			'slot:&zone.region.owner=,a\\,b,&',
			'zone.region.owner',
		)).toEqual(['zone.region.owner=a\\,b']);
	});
});

describe('scopedCacheRowBuckets', () => {
	it('reads the bare set and the one each written row owns', () => {
		expect(scopedCacheRowBuckets(
			[
				'slot:&id=,1,&method=,spaced,&zone.region.owner=,ana,&',
				'slot:&id=,2,&method=,massed,&zone.region.owner=,bo,&',
			],
			'zone.region.owner',
		)).toEqual(['', 'zone.region.owner=ana', 'zone.region.owner=bo']);
	});

	it('reads one set for two rows of the same bucket value', () => {
		expect(scopedCacheRowBuckets(
			[
				'slot:&id=,1,&zone.region.owner=,ana,&',
				'slot:&id=,2,&zone.region.owner=,ana,&',
			],
			'zone.region.owner',
		)).toEqual(['', 'zone.region.owner=ana']);
	});

	it('reads the bare set alone for a row whose bucket value never resolved', () => {
		expect(scopedCacheRowBuckets(['slot:&id=,1,&'], 'zone.region.owner'))
			.toEqual(['']);
	});

	it('reads the bare set alone for a collection with no bucket path', () => {
		expect(scopedCacheRowBuckets(['loose:&id=,1,&'], null)).toEqual(['']);
	});
});

describe('renderScopedCacheIndexMember', () => {
	it('carries the query case and the key it protects in one member', () => {
		expect(renderScopedCacheIndexMember('slot:&method=,spaced,&', 'ns:abc'))
			.toBe('slot:&method=,spaced,&|ns:abc');
	});

	it('reads a member back, splitting on the fingerprint\'s own terminator', () => {
		expect(parseScopedCacheIndexMember('slot:&method=,spaced,&|ns:abc'))
			.toEqual({ fingerprint: 'slot:&method=,spaced,&', key: 'ns:abc' });
	});

	it('reads a key carrying a pipe of its own back whole', () => {
		expect(parseScopedCacheIndexMember('slot:&|ns:a|b'))
			.toEqual({ fingerprint: 'slot:&', key: 'ns:a|b' });
	});

	it('reads a member holding no key as a fingerprint alone', () => {
		expect(parseScopedCacheIndexMember('slot:&'))
			.toEqual({ fingerprint: 'slot:&', key: '' });
	});
});
