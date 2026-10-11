import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionBatchUpdate = 'test_ws_batch_update';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			await DeleteCollection(vendor, { collection: collectionBatchUpdate });

			const response = await CreateCollections(vendor, {
				collections: [
					{
						collection: collectionBatchUpdate,
						meta: {},
						fields: [
							{ field: 'name', type: 'string', meta: {} },
							{ field: 'status', type: 'string', meta: {} },
						],
					},
				],
			});

			expect(response).toBeTruthy();
		},
		300_000,
	);
};
