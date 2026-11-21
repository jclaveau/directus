import { CreateCollections, DeleteCollectionIfPresent } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionMembershipNotes = 'test_ws_membership_notes';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			await DeleteCollectionIfPresent(vendor, {
				collection: collectionMembershipNotes,
			});

			const response = await CreateCollections(vendor, {
				collections: [
					{
						collection: collectionMembershipNotes,
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
