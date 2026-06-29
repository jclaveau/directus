import {
	CreateCollection,
	CreateField,
	CreateFieldM2A,
	CreateFieldM2M,
	CreateFieldM2O,
	CreateFieldO2M,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

export const collectionFirst = 'test_app_cache_first';
export const collectionIgnored = 'test_app_cache_ignored';
// Collections joined by `collectionFirst` through each relation type, so a write to any
// of them can be shown to invalidate a cached read that joined it: m2o (related),
// o2m (child), m2m (tag), m2a (block).
export const collectionRelated = 'test_app_cache_related';
export const collectionChild = 'test_app_cache_child';
export const collectionTag = 'test_app_cache_tag';
export const collectionBlock = 'test_app_cache_block';

const junctionTag = 'test_app_cache_first_tag';
const junctionBlock = 'test_app_cache_first_block';

export type First = {
	id?: number;
	string_field?: string;
};

export type Second = {
	id?: number;
	string_field?: string;
};

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Delete existing collections — junctions first, then the FK-holders, then
				// the targets.
				await DeleteCollection(vendor, { collection: junctionTag });
				await DeleteCollection(vendor, { collection: junctionBlock });
				await DeleteCollection(vendor, { collection: collectionIgnored });
				await DeleteCollection(vendor, { collection: collectionChild });
				await DeleteCollection(vendor, { collection: collectionFirst });
				await DeleteCollection(vendor, { collection: collectionRelated });
				await DeleteCollection(vendor, { collection: collectionTag });
				await DeleteCollection(vendor, { collection: collectionBlock });

				// Create first collection
				await CreateCollection(vendor, {
					collection: collectionFirst,
				});

				await CreateField(vendor, {
					collection: collectionFirst,
					field: 'string_field',
					type: 'string',
				});

				// A target collection per relation type + the relation field on collectionFirst.
				for (const target of [
					collectionRelated,
					collectionChild,
					collectionTag,
					collectionBlock,
				]) {
					await CreateCollection(vendor, { collection: target });
					await CreateField(vendor, { collection: target, field: 'string_field', type: 'string' });
				}

				// m2o: collectionFirst.related → collectionRelated
				await CreateFieldM2O(vendor, {
					collection: collectionFirst,
					field: 'related',
					otherCollection: collectionRelated,
				});

				// o2m: collectionFirst.children → collectionChild (FK `parent_id` on the child)
				await CreateFieldO2M(vendor, {
					collection: collectionFirst,
					field: 'children',
					otherCollection: collectionChild,
					otherField: 'parent_id',
				});

				// m2m: collectionFirst.tags ↔ collectionTag (junction holds `${collectionTag}_id`)
				await CreateFieldM2M(vendor, {
					collection: collectionFirst,
					field: 'tags',
					otherCollection: collectionTag,
					otherField: 'firsts',
					junctionCollection: junctionTag,
				});

				// m2a: collectionFirst.blocks → [collectionBlock] (junction a2o `item`/`collection`)
				await CreateFieldM2A(vendor, {
					collection: collectionFirst,
					field: 'blocks',
					relatedCollections: [collectionBlock],
					junctionCollection: junctionBlock,
				});

				// Create second collection
				await CreateCollection(vendor, {
					collection: collectionIgnored,
				});

				await CreateField(vendor, {
					collection: collectionIgnored,
					field: 'string_field',
					type: 'string',
				});

				expect(true).toBeTruthy();
			} catch (error) {
				expect(error).toBeFalsy();
			}
		},
		300_000,
	);
};

export const seedDBValues = async () => {
	let isSeeded = true;

	await Promise.all(
		vendors.map(async (vendor) => {
			await CreateItem(vendor, {
				collection: collectionFirst,
				item: {
					string_field: randomUUID(),
				},
			});

			await CreateItem(vendor, {
				collection: collectionIgnored,
				item: {
					string_field: randomUUID(),
				},
			});
		}),
	)
		.then(() => {
			isSeeded = true;
		})
		.catch(() => {
			isSeeded = false;
		});

	return isSeeded;
};
