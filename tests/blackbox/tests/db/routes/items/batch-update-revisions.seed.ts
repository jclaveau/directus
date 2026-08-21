import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionTracked = 'test_items_batch_update_revisions';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionTracked });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionTracked,
							// Revisions carry a snapshot only when the collection
							// tracks `all`; `activity` records the action without one.
							meta: { accountability: 'all' },
							fields: [
								// `name` stays untouched by the batch update, so it
								// tells each row's snapshot apart from its neighbours'.
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
