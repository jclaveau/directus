import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionSingletonUpsert = 'test_singleton_upsert';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, {
					collection: collectionSingletonUpsert,
				});

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionSingletonUpsert,
							primaryKeyType: 'integer',
							meta: { singleton: true, accountability: 'all' },
							fields: [{ field: 'title', type: 'string', meta: {} }],
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
