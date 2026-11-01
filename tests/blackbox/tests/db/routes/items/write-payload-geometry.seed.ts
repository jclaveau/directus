import { CreateCollections, DeleteCollectionIfPresent } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionGeoSpot = 'test_write_geo_spot';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollectionIfPresent(vendor, { collection: collectionGeoSpot });

				// Its own seed: a vendor with no spatial support fails here alone.
				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionGeoSpot,
							primaryKeyType: 'string',
							meta: { accountability: 'all' },
							fields: [
								{ field: 'spot', type: 'geometry.Point', meta: {} },
							],
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
