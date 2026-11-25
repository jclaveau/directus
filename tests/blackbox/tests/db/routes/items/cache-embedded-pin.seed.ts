import {
	CreateCollections,
	CreateFieldO2M,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionOwner = 'pin_owner';
export const collectionOwnedItem = 'pin_owned_item';
export const collectionOwnedSubItem = 'pin_owned_sub_item';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: a child's FK blocks dropping its parent.
				for (const collection of [
					collectionOwnedSubItem,
					collectionOwnedItem,
					collectionOwner,
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				// String keys, so a scenario names every row it writes.
				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionOwner,
							primaryKeyType: 'string',
							meta: { scoped_cache_fields: ['space'] },
							fields: [{ field: 'space', type: 'string', meta: {} }],
						},
						{
							collection: collectionOwnedItem,
							primaryKeyType: 'string',
						},
						{
							collection: collectionOwnedSubItem,
							primaryKeyType: 'string',
							fields: [{ field: 'label', type: 'string', meta: {} }],
						},
					],
				});

				// CreateFieldO2M alone: it creates the foreign key and the relation
				// naming the alias. A CreateFieldM2O first creates that relation
				// without `one_field`, CreateRelation keeps the existing one, and the
				// alias is left one no relation names, read as a column.
				await CreateFieldO2M(vendor, {
					collection: collectionOwner,
					field: 'owned_items',
					primaryKeyType: 'string',
					otherCollection: collectionOwnedItem,
					otherField: 'owner',
				});

				await CreateFieldO2M(vendor, {
					collection: collectionOwnedItem,
					field: 'owned_sub_items',
					primaryKeyType: 'string',
					otherCollection: collectionOwnedSubItem,
					otherField: 'owned_item',
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
