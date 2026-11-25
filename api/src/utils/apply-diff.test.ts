import type { Diff } from 'deep-diff';
import { describe, expect, it } from 'vitest';
import type { SnapshotField } from '@directus/types';

import { isNestedMetaUpdate, isRelationalAlias } from './apply-diff.js';

describe('isNestedMetaUpdate', () => {
	it.each([
		{ kind: 'E', path: ['meta', 'options', 'option_a'], rhs: {} },
		{ kind: 'A', path: ['meta', 'options', 'option_a'], rhs: [] },
	] as Diff<SnapshotField>[])('Returns false when diff is kind $kind', (diff) => {
		expect(isNestedMetaUpdate(diff)).toBe(false);
	});

	it.each([
		{ kind: 'N', path: ['schema', 'default_value'], rhs: {} },
		{ kind: 'D', path: ['schema'], lhs: {} },
	] as Diff<SnapshotField>[])('Returns false when diff path is not nested in meta', (diff) => {
		expect(isNestedMetaUpdate(diff)).toBe(false);
	});

	it.each([
		{ kind: 'N', path: ['meta', 'options', 'option_a'], rhs: { test: 'value' } },
		{ kind: 'D', path: ['meta', 'options', 'option_b'], lhs: {} },
	] as Diff<SnapshotField>[])('Returns true when diff path is nested in meta', (diff) => {
		expect(isNestedMetaUpdate(diff)).toBe(true);
	});
});

describe('isRelationalAlias', () => {
	it.each([
		{ type: 'alias', special: ['o2m'], relationalAlias: true },
		{ type: 'alias', special: ['alias', 'no-data'], relationalAlias: false },
		{ type: 'integer', special: ['m2o'], relationalAlias: false },
		{ type: 'alias', special: null, relationalAlias: false },
	])('reads $type of special $special as $relationalAlias', ({
	type,
	special,
	relationalAlias,
}) => {
		expect(isRelationalAlias({
			collection: 'pin_owner',
			field: 'owned_items',
			type,
			meta: { special },
		} as any)).toBe(relationalAlias);
	});
});
