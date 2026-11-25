import type { Snapshot, SnapshotDiff } from '@directus/types';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FieldsService } from '../services/fields.js';
import { applyDiff } from './apply-diff.js';

const savedOrder = vi.hoisted(() => [] as string[]);

vi.mock('../database/index.js', () => {
	return { default: vi.fn() };
});

vi.mock('../database/helpers/index.js', () => {
	return {
		getHelpers: () => {
			return {
				schema: {
					preColumnChange: async () => false,
					postColumnChange: async () => undefined,
				},
			};
		},
	};
});

vi.mock('../cache.js', () => {
	return { flushCaches: vi.fn() };
});

vi.mock('../logger/index.js', () => {
	return { useLogger: () => ({ error: vi.fn() }) };
});

vi.mock('./get-schema.js', () => {
	return {
		getSchema: vi.fn(async () => ({ collections: {}, relations: [] })),
	};
});

vi.mock('./transaction.js', () => {
	return {
		transaction: vi.fn((trxKnex, runInTransaction) => {
			return runInTransaction(trxKnex);
		}),
	};
});

vi.mock('../services/collections.js', () => {
	return {
		CollectionsService: vi.fn(function () {
			return {};
		}),
	};
});

vi.mock('../services/fields.js', () => {
	return {
		FieldsService: vi.fn(function () {
			return {
				createField: vi.fn(async (
					collection: string,
					newField: { field: string },
				) => {
					savedOrder.push(`field ${collection}.${newField.field}`);
				}),
			};
		}),
	};
});

vi.mock('../services/relations.js', () => {
	return {
		RelationsService: vi.fn(function () {
			return {
				createOne: vi.fn(async (
					relation: { collection: string; field: string },
				) => {
					savedOrder.push(`relation ${relation.collection}.${relation.field}`);
				}),
			};
		}),
	};
});

const snapshotDiff = {
	collections: [],
	fields: [
		{
			collection: 'pin_owner',
			field: 'owned_items',
			diff: [
				{
					kind: 'N',
					rhs: {
						collection: 'pin_owner',
						field: 'owned_items',
						type: 'alias',
						meta: { special: ['o2m'] },
					},
				},
			],
		},
		{
			collection: 'pin_item',
			field: 'owner',
			diff: [
				{
					kind: 'N',
					rhs: {
						collection: 'pin_item',
						field: 'owner',
						type: 'integer',
						meta: { special: null },
					},
				},
			],
		},
	],
	relations: [
		{
			collection: 'pin_item',
			field: 'owner',
			related_collection: 'pin_owner',
			diff: [
				{
					kind: 'N',
					rhs: {
						collection: 'pin_item',
						field: 'owner',
						related_collection: 'pin_owner',
						meta: { one_field: 'owned_items' },
					},
				},
			],
		},
	],
} as unknown as SnapshotDiff;

const currentSnapshot = {
	collections: [],
	fields: [],
	relations: [],
} as unknown as Snapshot;

afterEach(() => {
	savedOrder.length = 0;
});

describe('applyDiff of a relational alias', () => {
	it('creates the alias once the relation naming it is created', async () => {
		await applyDiff(currentSnapshot, snapshotDiff, { database: {} as any });

		expect(savedOrder).toEqual([
			'field pin_item.owner',
			'relation pin_item.owner',
			'field pin_owner.owned_items',
		]);
	});

	it('rethrows the refusal of a field it creates', async () => {
		vi.mocked(FieldsService).mockImplementationOnce(function () {
			return {
				createField: vi.fn(async () => {
					throw new Error('field refused');
				}),
			} as any;
		});

		await expect(applyDiff(currentSnapshot, snapshotDiff, { database: {} as any }))
			.rejects.toEqual(new Error('field refused'));
	});
});
