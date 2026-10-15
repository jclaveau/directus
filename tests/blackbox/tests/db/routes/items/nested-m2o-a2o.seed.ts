import {
	CreateCollections,
	CreateField,
	CreateFieldM2O,
	CreateRelation,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionNestedCard = 'test_nested_m2o_card';
export const collectionNestedOwner = 'test_nested_m2o_owner';
export const collectionNestedTask = 'test_nested_m2o_task';
export const collectionNestedLink = 'test_nested_a2o_link';
export const collectionNestedPage = 'test_nested_a2o_page';
export const collectionNestedPost = 'test_nested_a2o_post';
export const collectionBatchBadge = 'test_batch_uuid_badge';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				for (const collection of [
					collectionNestedCard,
					collectionNestedTask,
					collectionNestedOwner,
					collectionNestedLink,
					collectionNestedPage,
					collectionNestedPost,
					collectionBatchBadge,
				]) {
					await DeleteCollection(vendor, { collection });
				}

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionNestedOwner,
							primaryKeyType: 'string',
							meta: { accountability: 'all' },
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							collection: collectionNestedCard,
							primaryKeyType: 'string',
							meta: { accountability: 'all' },
							fields: [
								{ field: 'title', type: 'string', meta: {} },
								{ field: 'note', type: 'string', meta: {} },
							],
						},
						{
							collection: collectionNestedTask,
							primaryKeyType: 'string',
							meta: { accountability: 'all' },
							fields: [{ field: 'title', type: 'string', meta: {} }],
						},
						{
							collection: collectionNestedPage,
							primaryKeyType: 'string',
							meta: { accountability: 'all' },
							fields: [{ field: 'title', type: 'string', meta: {} }],
						},
						{
							collection: collectionNestedPost,
							primaryKeyType: 'string',
							meta: { accountability: 'all' },
							fields: [{ field: 'title', type: 'string', meta: {} }],
						},
						{
							collection: collectionNestedLink,
							primaryKeyType: 'string',
							meta: { accountability: 'all' },
							fields: [
								{ field: 'label', type: 'string', meta: {} },
								{ field: 'target_collection', type: 'string', meta: {} },
							],
						},
						{
							collection: collectionBatchBadge,
							primaryKeyType: 'uuid',
							meta: { accountability: 'all' },
							fields: [{ field: 'label', type: 'string', meta: {} }],
						},
					],
				});

				await CreateFieldM2O(vendor, {
					collection: collectionNestedCard,
					field: 'owner',
					primaryKeyType: 'string',
					otherCollection: collectionNestedOwner,
				});

				await CreateFieldM2O(vendor, {
					collection: collectionNestedTask,
					field: 'assignee',
					primaryKeyType: 'uuid',
					otherCollection: 'directus_users',
				});

				// An any-to-one field on the collection itself, not through a junction.
				await CreateField(vendor, {
					collection: collectionNestedLink,
					field: 'item',
					type: 'string',
				});

				await CreateRelation(vendor, {
					collection: collectionNestedLink,
					field: 'item',
					related_collection: null,
					meta: {
						one_allowed_collections: [
							collectionNestedPage,
							collectionNestedPost,
						],
						one_collection_field: 'target_collection',
					},
					schema: null,
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
