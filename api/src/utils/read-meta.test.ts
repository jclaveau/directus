import { describe, expect, test } from 'vitest';
import { readMeta, withMeta } from './read-meta.js';

describe('withMeta / readMeta', () => {
	test('round-trips the metadata via getMeta()', () => {
		const meta = { scopedCacheTags: [{ collection: 'articles' }, { collection: 'users' }] };
		const result = withMeta([{ id: 1 }], meta);

		expect(readMeta(result)).toBe(meta);
		expect(readMeta(result)!.scopedCacheTags).toEqual([{ collection: 'articles' }, { collection: 'users' }]);
	});

	test('getMeta is non-enumerable — invisible to JSON and spread', () => {
		const rows = withMeta([{ id: 1 }], { scopedCacheTags: [{ collection: 'articles' }] });

		expect(JSON.stringify(rows)).toBe('[{"id":1}]');
		expect(Object.keys(rows)).toEqual(['0']);
		// a spread/rebuild drops the rider (documented fragility → caller falls back to TTL)
		expect(readMeta([...rows])).toBeUndefined();
	});

	test('works on a single object as well as an array', () => {
		const item = withMeta({ id: 1 }, { scopedCacheTags: [{ collection: 'articles' }] });
		expect(readMeta(item)!.scopedCacheTags).toEqual([{ collection: 'articles' }]);
	});

	test('readMeta is safe on values without metadata', () => {
		expect(readMeta(null)).toBeUndefined();
		expect(readMeta(undefined)).toBeUndefined();
		expect(readMeta([{ id: 1 }])).toBeUndefined();
		expect(readMeta('nope')).toBeUndefined();
	});
});
