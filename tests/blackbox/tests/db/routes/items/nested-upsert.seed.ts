import {
	CreateCollections,
	CreateFieldO2M,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionParents = 'test_nested_upsert';
export const collectionChildren = 'test_nested_upsert_child';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionChildren });
				await DeleteCollection(vendor, { collection: collectionParents });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionParents,
							meta: {},
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							collection: collectionChildren,
							meta: {},
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
					],
				});

				// `one_deselect_action` is left at its default, so an array that omits a
				// child nullifies its `parent` rather than deleting the row — which is
				// what the empty-array case below reads back.
				await CreateFieldO2M(vendor, {
					collection: collectionParents,
					field: 'children',
					primaryKeyType: 'integer',
					otherCollection: collectionChildren,
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
