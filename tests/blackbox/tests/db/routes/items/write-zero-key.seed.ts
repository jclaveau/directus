import {
	CreateCollections,
	CreateFieldO2M,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionZeroParent = 'test_write_zero_parent';
export const collectionZeroListed = 'test_write_zero_listed';
export const collectionZeroSorted = 'test_write_zero_sorted';
export const collectionZeroPlain = 'test_write_zero_plain';
export const collectionZeroCounted = 'test_write_zero_counted';
export const collectionZeroHolder = 'test_write_zero_holder';
export const collectionZeroMember = 'test_write_zero_member';

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
					collectionZeroCounted,
					collectionZeroMember,
					collectionZeroHolder,
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
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
						{
							collection: collectionZeroCounted,
							primaryKeyType: 'integer',
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{ collection: collectionZeroHolder, primaryKeyType: 'integer' },
						{ collection: collectionZeroMember, primaryKeyType: 'integer' },
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

				await CreateFieldO2M(vendor, {
					collection: collectionZeroHolder,
					field: 'members',
					primaryKeyType: 'integer',
					otherCollection: collectionZeroMember,
					otherField: 'holder',
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
