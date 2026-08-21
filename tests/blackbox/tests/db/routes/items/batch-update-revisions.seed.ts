import { CreateCollection, CreateField, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionTracked = 'test_items_batch_update_revisions';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollection(vendor, { collection: collectionTracked });

				await CreateCollection(vendor, {
					collection: collectionTracked,
					primaryKeyType: 'integer',
					// Revisions carry a snapshot only when the collection tracks
					// `all`; `activity` records the action without one.
					meta: { accountability: 'all' },
					schema: {},
				});

				// `name` stays untouched by the batch update below, so it tells
				// each row's snapshot apart from its neighbours'.
				await CreateField(vendor, {
					collection: collectionTracked,
					field: 'name',
					type: 'string',
					meta: {},
					schema: {},
				});

				await CreateField(vendor, {
					collection: collectionTracked,
					field: 'status',
					type: 'string',
					meta: {},
					schema: {},
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
