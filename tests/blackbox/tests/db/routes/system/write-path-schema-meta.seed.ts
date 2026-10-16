import {
	CreateCollections,
	CreateFieldM2O,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionMetaOwners = 'test_wp_meta_owners';
export const collectionMetaPets = 'test_wp_meta_pets';
export const collectionMetaLinks = 'test_wp_meta_links';
export const collectionMetaBare = 'test_wp_meta_bare';
export const collectionMetaGql = 'test_wp_meta_gql';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionMetaPets });
				await DeleteCollection(vendor, { collection: collectionMetaLinks });
				await DeleteCollection(vendor, { collection: collectionMetaOwners });
				await DeleteCollection(vendor, { collection: collectionMetaBare });
				await DeleteCollection(vendor, { collection: collectionMetaGql });

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
