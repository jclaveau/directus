import {
	CreateCollections,
	CreateFieldO2M,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

const slotScoped = { scoped_cache_fields: ['slot'], accountability: null };
const slotField = { field: 'slot', type: 'string', meta: {} };
const bodyField = { field: 'body', type: 'string', meta: {} };

const uniqueCodeField = {
	field: 'code',
	type: 'string',
	meta: {},
	schema: { is_unique: true },
};

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: a child's FK blocks dropping its parent.
				for (const collection of [
					'test_wcf_update_precise',
					'test_wcf_update_coarse',
					'test_wcf_nested_child',
					'test_wcf_nested_parent',
					'test_wcf_nested_foreign',
					'test_wcf_delete',
					'test_wcf_delete_foreign',
					'test_wcf_upsert_takeover',
					'test_wcf_upsert_declared',
					'test_wcf_upsert_foreign',
					'test_wcf_upsert_shared',
					'test_wcf_upsert_uncached',
					'test_wcf_upsert_added',
				]) {
					await DeleteCollection(vendor, { collection });
				}

				await CreateCollections(vendor, {
					collections: [
						{
							collection: 'test_wcf_update_precise',
							meta: slotScoped,
							fields: [slotField, bodyField, uniqueCodeField],
						},
						{
							collection: 'test_wcf_update_coarse',
							meta: slotScoped,
							fields: [slotField, bodyField, uniqueCodeField],
						},
						{
							collection: 'test_wcf_nested_parent',
							meta: { accountability: null },
							fields: [{ field: 'title', type: 'string', meta: {} }],
						},
						{
							collection: 'test_wcf_nested_child',
							meta: slotScoped,
							fields: [slotField, bodyField, uniqueCodeField],
						},
						{
							collection: 'test_wcf_nested_foreign',
							meta: { accountability: null },
							fields: [bodyField],
						},
						{
							collection: 'test_wcf_delete',
							meta: slotScoped,
							fields: [slotField, bodyField],
						},
						{
							collection: 'test_wcf_delete_foreign',
							meta: { accountability: null },
							fields: [bodyField],
						},
						{
							collection: 'test_wcf_upsert_takeover',
							meta: slotScoped,
							fields: [slotField, bodyField],
						},
						{
							collection: 'test_wcf_upsert_declared',
							meta: slotScoped,
							fields: [slotField, bodyField],
						},
						{
							collection: 'test_wcf_upsert_foreign',
							meta: { accountability: null },
							fields: [bodyField],
						},
						{
							collection: 'test_wcf_upsert_shared',
							meta: slotScoped,
							fields: [slotField, bodyField],
						},
						{
							collection: 'test_wcf_upsert_uncached',
							meta: { accountability: null },
							fields: [bodyField],
						},
						{
							collection: 'test_wcf_upsert_added',
							meta: slotScoped,
							fields: [slotField, bodyField],
						},
					],
				});

				await CreateFieldO2M(vendor, {
					collection: 'test_wcf_nested_parent',
					field: 'children',
					otherCollection: 'test_wcf_nested_child',
					otherField: 'parent',
				});

				expect(true).toBeTruthy();
			}
			catch (error) {
				expect(error).toBeFalsy();
			}
		},
		300_000,
	);
};
