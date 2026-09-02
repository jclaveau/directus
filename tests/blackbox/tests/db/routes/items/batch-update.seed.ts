import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionBatched = 'test_batch_update';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionBatched });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionBatched,
							meta: {},
							fields: [
								{ field: 'name', type: 'string', meta: {} },
								{ field: 'status', type: 'string', meta: {} },
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
