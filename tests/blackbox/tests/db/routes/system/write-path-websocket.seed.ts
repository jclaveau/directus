import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionSocketNotes = 'test_wp_socket_notes';
export const collectionSocketBanner = 'test_wp_socket_banner';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionSocketNotes });
				await DeleteCollection(vendor, { collection: collectionSocketBanner });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionSocketNotes,
							meta: {},
							fields: [{ field: 'title', type: 'string', meta: {} }],
							primaryKeyType: 'string',
						},
						{
							collection: collectionSocketBanner,
							meta: { singleton: true },
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
