import {
	CreateCollections,
	CreateFieldM2O,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionDiffOwners = 'test_wp_diff_owners';
export const collectionDiffPets = 'test_wp_diff_pets';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionDiffPets });
				await DeleteCollection(vendor, { collection: collectionDiffOwners });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionDiffOwners,
							meta: {},
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							collection: collectionDiffPets,
							meta: {},
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
					],
				});

				await CreateFieldM2O(vendor, {
					collection: collectionDiffPets,
					field: 'owner_id',
					otherCollection: collectionDiffOwners,
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
