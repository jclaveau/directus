import { CreateCollections, DeleteCollectionIfPresent } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionPorterCrates = 'test_wp_porter_crates';
export const collectionPorterBroken = 'test_wp_porter_broken';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollectionIfPresent(vendor, {
					collection: collectionPorterCrates,
				});

				await DeleteCollectionIfPresent(vendor, {
					collection: collectionPorterBroken,
				});

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionPorterCrates,
							meta: {},
							fields: [{ field: 'title', type: 'string', meta: {} }],
							primaryKeyType: 'string',
						},
						{
							collection: collectionPorterBroken,
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
