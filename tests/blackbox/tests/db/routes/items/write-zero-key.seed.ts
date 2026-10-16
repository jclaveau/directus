import {
	CreateCollections,
	CreateFieldO2M,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionZeroParent = 'test_write_zero_parent';
export const collectionZeroListed = 'test_write_zero_listed';
export const collectionZeroSorted = 'test_write_zero_sorted';
export const collectionZeroPlain = 'test_write_zero_plain';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: a child's FK blocks dropping its parent.
				for (const collection of [
					collectionZeroListed,
					collectionZeroSorted,
					collectionZeroPlain,
					collectionZeroParent,
				]) {
					await DeleteCollection(vendor, { collection });
				}

				await CreateCollections(vendor, {
					collections: [
						{ collection: collectionZeroParent, primaryKeyType: 'integer' },
						{ collection: collectionZeroListed, primaryKeyType: 'string' },
						{
							collection: collectionZeroSorted,
							primaryKeyType: 'string',
							fields: [{ field: 'position', type: 'integer', meta: {} }],
						},
						{ collection: collectionZeroPlain, primaryKeyType: 'string' },
					],
				});

				for (const [field, otherCollection, relationMeta] of [
					['listed', collectionZeroListed, {}],
					['sorted', collectionZeroSorted, { sort_field: 'position' }],
					['plain', collectionZeroPlain, {}],
				] as const) {
					await CreateFieldO2M(vendor, {
						collection: collectionZeroParent,
						field,
						primaryKeyType: 'integer',
						otherCollection,
						otherField: 'parent',
						relationMeta,
					});
				}

				expect(true).toBeTruthy();
			}
			catch (error) {
				expect(error).toBeFalsy();
			}
		},
		300_000,
	);
};
