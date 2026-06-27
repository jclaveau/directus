import { CreateCollection, CreateField, CreateFieldM2O, CreateItem, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';

export const collectionFirst = 'test_app_cache_first';
export const collectionIgnored = 'test_app_cache_ignored';
// Related collection joined by `collectionFirst.related` (m2o), to test that a write to a related
// collection invalidates a cached read that joined it.
export const collectionRelated = 'test_app_cache_related';

export type First = {
	id?: number;
	string_field?: string;
};

export type Second = {
	id?: number;
	string_field?: string;
};

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Delete existing collections (collectionFirst first — it holds the FK to collectionRelated)
				await DeleteCollection(vendor, { collection: collectionIgnored });
				await DeleteCollection(vendor, { collection: collectionFirst });
				await DeleteCollection(vendor, { collection: collectionRelated });

				// Create first collection
				await CreateCollection(vendor, {
					collection: collectionFirst,
				});

				await CreateField(vendor, {
					collection: collectionFirst,
					field: 'string_field',
					type: 'string',
				});

				// Create related collection + an m2o from collectionFirst → collectionRelated
				await CreateCollection(vendor, {
					collection: collectionRelated,
				});

				await CreateField(vendor, {
					collection: collectionRelated,
					field: 'string_field',
					type: 'string',
				});

				await CreateFieldM2O(vendor, {
					collection: collectionFirst,
					field: 'related',
					otherCollection: collectionRelated,
				});

				// Create second collection
				await CreateCollection(vendor, {
					collection: collectionIgnored,
				});

				await CreateField(vendor, {
					collection: collectionIgnored,
					field: 'string_field',
					type: 'string',
				});

				expect(true).toBeTruthy();
			} catch (error) {
				expect(error).toBeFalsy();
			}
		},
		300_000,
	);
};

export const seedDBValues = async () => {
	let isSeeded = true;

	await Promise.all(
		vendors.map(async (vendor) => {
			await CreateItem(vendor, {
				collection: collectionFirst,
				item: {
					string_field: randomUUID(),
				},
			});

			await CreateItem(vendor, {
				collection: collectionIgnored,
				item: {
					string_field: randomUUID(),
				},
			});
		}),
	)
		.then(() => {
			isSeeded = true;
		})
		.catch(() => {
			isSeeded = false;
		});

	return isSeeded;
};
