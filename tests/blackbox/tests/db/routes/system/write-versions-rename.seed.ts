import { CreateCollections, DeleteCollectionIfPresent } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionRenamedDraft = 'test_write_renamed';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollectionIfPresent(vendor, {
					collection: collectionRenamedDraft,
				});

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionRenamedDraft,
							meta: { versioning: true },
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
