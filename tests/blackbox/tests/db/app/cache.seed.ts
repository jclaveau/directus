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
// Second-hop leaves, so a read nested two relations deep can be shown to drop when the leaf is
// mutated. `grandRelated` is the m2o leaf reached from several first-hop targets (related.grand,
// child.owner, tag.category, block.author); `grandChild` is the o2m leaf (related.subs,
// child.subChildren). Between them they give a depth-2 chain per first-hop relation type.
export const collectionGrandRelated = 'test_app_cache_grand_related';
export const collectionGrandChild = 'test_app_cache_grand_child';

// A value-scoped collection: `scoped_cache_fields = [owner_field]` partitions its cache by
// owner, and a self-referential `parent` m2o lets a read reach the same collection through
// an unbounded path (exercises the self-reference guard). Two baseline owners are seeded.
export const collectionScoped = 'test_app_cache_scoped';
export const scopedOwnerA = 'owner-a';
export const scopedOwnerB = 'owner-b';

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
				// Delete existing collections — FK-holders before their targets. grandChild holds
				// FKs to child + related; child holds FKs to first + grandRelated; first/related/
				// tag/block all point at grandRelated, so grandRelated goes last.
				await DeleteCollection(vendor, { collection: junctionTag });
				await DeleteCollection(vendor, { collection: junctionBlock });
				await DeleteCollection(vendor, { collection: collectionScoped });
				await DeleteCollection(vendor, { collection: collectionIgnored });
				await DeleteCollection(vendor, { collection: collectionGrandChild });
				await DeleteCollection(vendor, { collection: collectionChild });
				await DeleteCollection(vendor, { collection: collectionFirst });
				await DeleteCollection(vendor, { collection: collectionRelated });
				await DeleteCollection(vendor, { collection: collectionTag });
				await DeleteCollection(vendor, { collection: collectionBlock });
				await DeleteCollection(vendor, { collection: collectionGrandRelated });

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
					collectionGrandRelated,
					collectionGrandChild,
				]) {
					await CreateCollection(vendor, { collection: target });

					await CreateField(vendor, {
						collection: target,
						field: 'string_field',
						type: 'string',
					});
				}

				// m2o: collectionFirst.related → collectionRelated
				await CreateFieldM2O(vendor, {
					collection: collectionFirst,
					field: 'related',
					otherCollection: collectionRelated,
				});

				// m2o 2nd hop: collectionRelated.grand → collectionGrandRelated (the chain leaf)
				await CreateFieldM2O(vendor, {
					collection: collectionRelated,
					field: 'grand',
					otherCollection: collectionGrandRelated,
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

				// Second-hop relations, one off each first-hop target, so a depth-2 read exists for
				// every relation type. m2o leaves land on grandRelated, o2m leaves on grandChild.
				// o2m→m2o: collectionChild.owner → grandRelated
				await CreateFieldM2O(vendor, {
					collection: collectionChild,
					field: 'owner',
					otherCollection: collectionGrandRelated,
				});

				// m2m→m2o: collectionTag.category → grandRelated
				await CreateFieldM2O(vendor, {
					collection: collectionTag,
					field: 'category',
					otherCollection: collectionGrandRelated,
				});

				// m2a→m2o: collectionBlock.author → grandRelated
				await CreateFieldM2O(vendor, {
					collection: collectionBlock,
					field: 'author',
					otherCollection: collectionGrandRelated,
				});

				// m2o→o2m: collectionRelated.subs → grandChild (FK `related_id` on grandChild)
				await CreateFieldO2M(vendor, {
					collection: collectionRelated,
					field: 'subs',
					otherCollection: collectionGrandChild,
					otherField: 'related_id',
				});

				// o2m→o2m: collectionChild.subChildren → grandChild (FK `child_id` on grandChild)
				await CreateFieldO2M(vendor, {
					collection: collectionChild,
					field: 'subChildren',
					otherCollection: collectionGrandChild,
					otherField: 'child_id',
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

				// Value-scoped collection: partition the cache by `owner_field`.
				await CreateCollection(vendor, {
					collection: collectionScoped,
					meta: { scoped_cache_fields: ['owner_field'] },
				});

				await CreateField(vendor, {
					collection: collectionScoped,
					field: 'string_field',
					type: 'string',
				});

				await CreateField(vendor, {
					collection: collectionScoped,
					field: 'owner_field',
					type: 'string',
				});

				// Self-referential m2o, so a read can reach the same collection through an
				// unbounded path (`parent.*`) — the self-reference guard's target.
				await CreateFieldM2O(vendor, {
					collection: collectionScoped,
					field: 'parent',
					otherCollection: collectionScoped,
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

			// One row per owner slice, so a read can be pinned to a single owner.
			await CreateItem(vendor, {
				collection: collectionScoped,
				item: { string_field: randomUUID(), owner_field: scopedOwnerA },
			});

			await CreateItem(vendor, {
				collection: collectionScoped,
				item: { string_field: randomUUID(), owner_field: scopedOwnerB },
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
