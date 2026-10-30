import {
	CreateCollections,
	CreateFieldM2O,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionMetaOwners = 'test_wp_meta_owners';
export const collectionMetaPets = 'test_wp_meta_pets';
export const collectionMetaLinks = 'test_wp_meta_links';
export const collectionMetaBare = 'test_wp_meta_bare';
export const collectionMetaGql = 'test_wp_meta_gql';
export const collectionMetaGqlField = 'test_wp_meta_gql_field';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollectionIfPresent(vendor, { collection: collectionMetaPets });
				await DeleteCollectionIfPresent(vendor, { collection: collectionMetaLinks });

				await DeleteCollectionIfPresent(vendor, {
					collection: collectionMetaOwners,
				});

				await DeleteCollectionIfPresent(vendor, { collection: collectionMetaBare });
				await DeleteCollectionIfPresent(vendor, { collection: collectionMetaGql });

				await DeleteCollectionIfPresent(vendor, {
					collection: collectionMetaGqlField,
				});

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionMetaOwners,
							meta: {},
							fields: [{ field: 'label', type: 'string', meta: {} }],
						},
						{
							collection: collectionMetaPets,
							meta: {},
							fields: [{ field: 'spare_id', type: 'integer', meta: {} }],
						},
						{
							collection: collectionMetaLinks,
							meta: {},
							fields: [{ field: 'link_id', type: 'integer', meta: {} }],
						},
					],
				});

				await CreateFieldM2O(vendor, {
					collection: collectionMetaPets,
					field: 'owner_id',
					otherCollection: collectionMetaOwners,
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
