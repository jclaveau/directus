import { CreateCollections, DeleteCollectionIfPresent } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionReinit = 'test_ws_gql_reinit';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			await DeleteCollectionIfPresent(vendor, { collection: collectionReinit });

			const response = await CreateCollections(vendor, {
				collections: [
					{
						collection: collectionReinit,
						meta: {},
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			expect(response).toBeTruthy();
		},
		300_000,
	);
};
