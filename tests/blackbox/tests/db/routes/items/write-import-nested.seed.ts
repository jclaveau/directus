import {
	CreateCollections,
	CreateField,
	CreateFieldO2M,
	CreateRelation,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionImportParent = 'test_write_import_parent';
export const collectionImportPage = 'test_write_import_page';
export const collectionImportDeleted = 'test_write_import_deleted';
export const collectionImportNulled = 'test_write_import_nulled';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: a child's FK blocks dropping its parent.
				for (const collection of [
					collectionImportDeleted,
					collectionImportNulled,
					collectionImportParent,
					collectionImportPage,
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionImportParent,
							primaryKeyType: 'string',
							fields: [
								{ field: 'target_collection', type: 'string', meta: {} },
							],
						},
						{
							collection: collectionImportPage,
							primaryKeyType: 'string',
							fields: [{ field: 'title', type: 'string', meta: {} }],
						},
						{
							collection: collectionImportDeleted,
							primaryKeyType: 'string',
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							collection: collectionImportNulled,
							primaryKeyType: 'string',
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
					],
				});

				// An any-to-one field on the collection itself, reaching the pages.
				await CreateField(vendor, {
					collection: collectionImportParent,
					field: 'target',
					type: 'string',
				});

				await CreateRelation(vendor, {
					collection: collectionImportParent,
					field: 'target',
					related_collection: null,
					meta: {
						one_allowed_collections: [collectionImportPage],
						one_collection_field: 'target_collection',
					},
					schema: null,
				});

				await CreateFieldO2M(vendor, {
					collection: collectionImportParent,
					field: 'deleted',
					primaryKeyType: 'string',
					otherCollection: collectionImportDeleted,
					otherField: 'parent',
					relationMeta: { one_deselect_action: 'delete' },
				});

				await CreateFieldO2M(vendor, {
					collection: collectionImportParent,
					field: 'nulled',
					primaryKeyType: 'string',
					otherCollection: collectionImportNulled,
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
