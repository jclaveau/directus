import { DiffKind, type SnapshotDiff } from '@directus/types';
import { expect, test, vi } from 'vitest';
import {
	filterSnapshotDiff,
	formatSnapshotDiff,
	isEmptySnapshotDiff,
} from './report-diff.js';

// Colour codes would tie the assertions to the terminal the test runs in
vi.mock('chalk', () => {
	const plain = (text: string) => text;

	return {
		default: {
			underline: { bold: plain },
			magenta: plain,
			red: plain,
			green: plain,
		},
	};
});

function diffOf(overrides: Partial<SnapshotDiff>): SnapshotDiff {
	return {
		collections: [],
		fields: [],
		relations: [],
		...overrides,
	} as unknown as SnapshotDiff;
}

test('an empty diff is one with nothing in any section', () => {
	expect(isEmptySnapshotDiff(diffOf({}))).toBe(true);

	expect(isEmptySnapshotDiff(diffOf({
		relations: [{ collection: 'a', field: 'b', diff: [] }],
	} as unknown as SnapshotDiff))).toBe(false);
});

test('drops a whole collection, or one field, by name', () => {
	const filtered = filterSnapshotDiff(diffOf({
		collections: [
			{ collection: 'articles', diff: [] },
			{ collection: 'authors', diff: [] },
		],
		fields: [
			{ collection: 'articles', field: 'title', diff: [] },
			{ collection: 'authors', field: 'name', diff: [] },
			{ collection: 'authors', field: 'email', diff: [] },
		],
		relations: [
			{ collection: 'articles', field: 'author', diff: [] },
			{ collection: 'authors', field: 'avatar', diff: [] },
		],
	} as unknown as SnapshotDiff), ['articles', 'authors.email']);

	expect(filtered.collections.map((item) => item.collection)).toEqual(['authors']);
	expect(filtered.fields.map((item) => item.field)).toEqual(['name']);
	expect(filtered.relations.map((item) => item.field)).toEqual(['avatar']);
});

test('lists a collection by the kind of its first change', () => {
	const listing = formatSnapshotDiff(diffOf({
		collections: [
			{
				collection: 'edited',
				diff: [
					{ kind: DiffKind.EDIT, path: ['meta', 'note'], lhs: 'a', rhs: 'b' },
					{ kind: DiffKind.NEW, path: ['meta', 'icon'], rhs: 'star' },
				],
			},
			{ collection: 'gone', diff: [{ kind: DiffKind.DELETE, lhs: {} }] },
			{ collection: 'fresh', diff: [{ kind: DiffKind.NEW, rhs: {} }] },
			{
				collection: 'reordered',
				diff: [{ kind: DiffKind.ARRAY, path: ['meta', 'x'], index: 0 }],
			},
			{ collection: 'silent', diff: [] },
		],
	} as unknown as SnapshotDiff));

	// Only edits of a collection are listed; its nested additions are not
	expect(listing).toBe([
		'Collections:',
		'  - Update edited',
		'    - Set note to b',
		'  - Delete gone',
		'  - Create fresh',
		'  - Update reordered',
	].join('\n'));
});

test('lists what a field gains and loses under its meta', () => {
	const listing = formatSnapshotDiff(diffOf({
		fields: [
			{
				collection: 'articles',
				field: 'title',
				diff: [
					{ kind: DiffKind.NEW, path: ['meta', 'note'], rhs: 'hi' },
					{ kind: DiffKind.DELETE, path: ['meta', 'width'], lhs: 'full' },
					{ kind: DiffKind.EDIT, path: ['type'], lhs: 'a', rhs: 'b' },
				],
			},
			{
				collection: 'articles',
				field: 'body',
				diff: [{ kind: DiffKind.NEW, rhs: { field: 'body' } }],
			},
		],
	} as unknown as SnapshotDiff));

	expect(listing).toBe([
		'Fields:',
		'  - Update articles.title',
		'    - Add note and set it to hi',
		'    - Remove width',
		'    - Set type to b',
		'  - Create articles.body',
	].join('\n'));
});

test('names the related collection of a relation when it has one', () => {
	const listing = formatSnapshotDiff(diffOf({
		relations: [
			{
				collection: 'articles',
				field: 'author',
				related_collection: 'authors',
				diff: [{ kind: DiffKind.NEW, rhs: {} }],
			},
			{
				collection: 'articles',
				field: 'item',
				related_collection: null,
				diff: [{ kind: DiffKind.DELETE, lhs: {} }],
			},
		],
	} as unknown as SnapshotDiff));

	expect(listing).toBe([
		'Relations:',
		'  - Create articles.author → authors',
		'  - Delete articles.item',
	].join('\n'));
});

test('separates the sections with a blank line', () => {
	const listing = formatSnapshotDiff(diffOf({
		collections: [{ collection: 'a', diff: [{ kind: DiffKind.NEW, rhs: {} }] }],
		relations: [
			{ collection: 'a', field: 'b', diff: [{ kind: DiffKind.NEW, rhs: {} }] },
		],
	} as unknown as SnapshotDiff));

	expect(listing).toBe(
		'Collections:\n  - Create a\n\nRelations:\n  - Create a.b',
	);
});
