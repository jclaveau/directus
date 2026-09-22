import { oneLine } from '@directus/utils';
import { describe, expect, it } from 'vitest';
import {
	scopedCacheChangedFields,
	scopedCacheUpdatedRows,
	scopedCacheWrittenRows,
} from './mutated-rows.js';

// The fingerprint plays no part in the diff — it is the row that is compared —
// so every case below carries the same one.
const fingerprint = 'slot:&id=,1,&';

describe('scopedCacheChangedFields', () => {
	it('names the column the write rewrote, and no other', () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: { id: 1, owner: 'alpha', note: 'first' }, fingerprint }],
			[{ key: 1, row: { id: 1, owner: 'alpha', note: 'second' }, fingerprint }],
		)).toEqual(['note']);
	});

	it('names nothing when the write stored the same values', () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: { id: 1, owner: 'alpha', note: 'first' }, fingerprint }],
			[{ key: 1, row: { id: 1, owner: 'alpha', note: 'first' }, fingerprint }],
		)).toEqual([]);
	});

	it(oneLine`
		unions the columns of a batch: one entry is purged by the whole write, not by
		the row that happens to match it
	`, () => {
		expect(scopedCacheChangedFields(
			[
				{ key: 1, row: { id: 1, owner: 'alpha', note: 'first' }, fingerprint },
				{ key: 2, row: { id: 2, owner: 'beta', note: 'second' }, fingerprint },
			],
			[
				{ key: 1, row: { id: 1, owner: 'gamma', note: 'first' }, fingerprint },
				{ key: 2, row: { id: 2, owner: 'beta', note: 'third' }, fingerprint },
			],
		)).toEqual(['note', 'owner']);
	});

	it('matches the two sides by key rather than by position', () => {
		expect(scopedCacheChangedFields(
			[
				{ key: 1, row: { id: 1, owner: 'alpha' }, fingerprint },
				{ key: 2, row: { id: 2, owner: 'beta' }, fingerprint },
			],
			[
				{ key: 2, row: { id: 2, owner: 'beta' }, fingerprint },
				{ key: 1, row: { id: 1, owner: 'alpha' }, fingerprint },
			],
		)).toEqual([]);
	});

	// The pk type differs between the two reads on a dialect handing a bigint back
	// as a string once and a number the other time; the row is the same row.
	it('matches a key of one type against the same key of another', () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: { id: 1, owner: 'alpha' }, fingerprint }],
			[{ key: '1', row: { id: 1, owner: 'beta' }, fingerprint }],
		)).toEqual(['owner']);
	});

	it('names the dotted terminal a write to the parent moved', () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: { id: 1, 'parent.area': 'north' }, fingerprint }],
			[{ key: 1, row: { id: 1, 'parent.area': 'south' }, fingerprint }],
		)).toEqual(['parent.area']);
	});

	it('reads a timestamp by its instant, not by the object the driver built', () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: { id: 1, updated: new Date(0) }, fingerprint }],
			[{ key: 1, row: { id: 1, updated: new Date(0) }, fingerprint }],
		)).toEqual([]);
	});

	it('names a timestamp the write moved', () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: { id: 1, updated: new Date(0) }, fingerprint }],
			[{ key: 1, row: { id: 1, updated: new Date(1000) }, fingerprint }],
		)).toEqual(['updated']);
	});

	it('reads a json column by its contents, not by its identity', () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: { id: 1, meta: { a: 1 } }, fingerprint }],
			[{ key: 1, row: { id: 1, meta: { a: 1 } }, fingerprint }],
		)).toEqual([]);
	});

	it('names a json column the write rewrote', () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: { id: 1, meta: { a: 1 } }, fingerprint }],
			[{ key: 1, row: { id: 1, meta: { a: 2 } }, fingerprint }],
		)).toEqual(['meta']);
	});

	it('names a column one side carries and the other does not', () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: { id: 1 }, fingerprint }],
			[{ key: 1, row: { id: 1, note: 'added' }, fingerprint }],
		)).toEqual(['note']);
	});

	it(oneLine`
		names every field when a row is on one side only — it entered or left the
		result set whichever columns it carries
	`, () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: { id: 1, owner: 'alpha' }, fingerprint }],
			[{ key: 2, row: { id: 2, owner: 'alpha' }, fingerprint }],
		)).toBe(null);
	});

	it('names every field when the two sides hold a different count', () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: { id: 1, owner: 'alpha' }, fingerprint }],
			[
				{ key: 1, row: { id: 1, owner: 'alpha' }, fingerprint },
				{ key: 2, row: { id: 2, owner: 'beta' }, fingerprint },
			],
		)).toBe(null);
	});

	it('names nothing for a write that touched no row at all', () => {
		expect(scopedCacheChangedFields([], [])).toEqual([]);
	});

	it(oneLine`
		names every field when a row's columns were never read: an unknown diff has
		to read as every field, never as none
	`, () => {
		expect(scopedCacheChangedFields(
			[{ key: 1, row: null, fingerprint }],
			[{ key: 1, row: null, fingerprint }],
		)).toBe(null);
	});
});

describe('scopedCacheWrittenRows', () => {
	it('shows the rows it wrote, and every field with them', () => {
		expect(scopedCacheWrittenRows({
			tags: [{ collection: 'slot', field: 'id', value: 1 }],
			rows: [{ key: 1, row: { id: 1 }, fingerprint }],
		})).toEqual({ fingerprints: ['slot:&id=,1,&'], changed: null });
	});

	it('shows nothing when the rows\' scope could not be resolved', () => {
		expect(scopedCacheWrittenRows({
			tags: null,
			rows: [{ key: 1, row: { id: 1 }, fingerprint }],
		})).toBe(undefined);
	});

	it('shows nothing when no row was read back', () => {
		expect(scopedCacheWrittenRows({ tags: [], rows: [] })).toBe(undefined);
	});
});

describe('scopedCacheUpdatedRows', () => {
	it('shows both sides of the row, and the column that moved', () => {
		expect(scopedCacheUpdatedRows(
			{
				tags: [],
				rows: [{
					key: 1,
					row: { id: 1, owner: 'alpha' },
					fingerprint: 'slot:&id=,1,&owner=,alpha,&',
				}],
			},
			{
				tags: [],
				rows: [{
					key: 1,
					row: { id: 1, owner: 'beta' },
					fingerprint: 'slot:&id=,1,&owner=,beta,&',
				}],
			},
		)).toEqual({
			fingerprints: ['slot:&id=,1,&owner=,alpha,&', 'slot:&id=,1,&owner=,beta,&'],
			changed: ['owner'],
		});
	});

	it('shows nothing when either side could not be resolved', () => {
		expect(scopedCacheUpdatedRows(
			{ tags: null, rows: [] },
			{ tags: [], rows: [{ key: 1, row: { id: 1 }, fingerprint }] },
		)).toBe(undefined);
	});

	it('shows nothing when neither side read a row back', () => {
		expect(scopedCacheUpdatedRows(
			{ tags: [], rows: [] },
			{ tags: [], rows: [] },
		)).toBe(undefined);
	});
});
