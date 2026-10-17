import { CreateCollections, DeleteCollectionIfPresent } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionVersioned = 'test_draft_items';
export const collectionUnversioned = 'test_plain_items';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollectionIfPresent(vendor, { collection: collectionVersioned });

				await DeleteCollectionIfPresent(vendor, {
					collection: collectionUnversioned,
				});

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionVersioned,
							meta: { versioning: true },
							fields: [{ field: 'title', type: 'string', meta: {} }],
						},
						{
							collection: collectionUnversioned,
							meta: {},
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
