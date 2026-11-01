import { CreateCollections, DeleteCollectionIfPresent } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionFlowCards = 'test_wp_flow_cards';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollectionIfPresent(vendor, { collection: collectionFlowCards });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionFlowCards,
							meta: {},
							fields: [{ field: 'title', type: 'string', meta: {} }],
							primaryKeyType: 'string',
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
