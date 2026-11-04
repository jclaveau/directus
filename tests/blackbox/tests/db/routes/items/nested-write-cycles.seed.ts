import {
	CreateCollections,
	CreateFieldM2O,
	CreateFieldO2M,
	DeleteCollectionIfPresent,
	DeleteFieldIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionNode = 'test_nested_cycle_node';
export const collectionOwner = 'test_nested_cycle_owner';
export const collectionEntry = 'test_nested_cycle_entry';
export const collectionRef = 'test_nested_cycle_ref';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// A foreign key into its own collection, or a pair pointing at each
				// other, blocks dropping the collection: drop those fields first.
				for (const { collection, field } of [
					{ collection: collectionNode, field: 'parent' },
					{ collection: collectionNode, field: 'link' },
					{ collection: collectionEntry, field: 'ref' },
					{ collection: collectionRef, field: 'entry' },
				]) {
					await DeleteFieldIfPresent(vendor, { collection, field });
				}

				for (const collection of [
					collectionNode,
					collectionRef,
					collectionEntry,
					collectionOwner,
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				// String keys, so a scenario names every row it writes and reads.
				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionNode,
							primaryKeyType: 'string',
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{ collection: collectionOwner, primaryKeyType: 'string' },
						{
							collection: collectionEntry,
							primaryKeyType: 'string',
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{ collection: collectionRef, primaryKeyType: 'string' },
					],
				});

				await CreateFieldO2M(vendor, {
					collection: collectionNode,
					field: 'children',
					primaryKeyType: 'string',
					otherCollection: collectionNode,
					otherField: 'parent',
				});

				await CreateFieldM2O(vendor, {
					collection: collectionNode,
					field: 'link',
					primaryKeyType: 'string',
					otherCollection: collectionNode,
				});

				await CreateFieldO2M(vendor, {
					collection: collectionOwner,
					field: 'entries',
					primaryKeyType: 'string',
					otherCollection: collectionEntry,
					otherField: 'owner',
				});

				await CreateFieldM2O(vendor, {
					collection: collectionEntry,
					field: 'ref',
					primaryKeyType: 'string',
					otherCollection: collectionRef,
				});

				await CreateFieldM2O(vendor, {
					collection: collectionRef,
					field: 'entry',
					primaryKeyType: 'string',
					otherCollection: collectionEntry,
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
