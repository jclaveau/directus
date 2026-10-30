import { CreateCollections, DeleteCollectionIfPresent } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionOwners = 'test_sw_owners';
export const collectionPets = 'test_sw_pets';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollectionIfPresent(vendor, { collection: collectionPets });
				await DeleteCollectionIfPresent(vendor, { collection: collectionOwners });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionOwners,
							meta: {},
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							collection: collectionPets,
							meta: {},
							fields: [{ field: 'owner_ref', type: 'integer', meta: {} }],
						},
					],
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
