import {
	CreateCollections,
	CreateFieldO2M,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionAnswerOwner = 'test_write_answer_owner';
export const collectionAnswerRow = 'test_write_answer_row';
export const collectionAnswerLedger = 'test_write_answer_ledger';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: a child's FK blocks dropping its parent.
				for (const collection of [
					collectionAnswerRow,
					collectionAnswerOwner,
					collectionAnswerLedger,
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				// Integer keys the scenarios choose, so a hook can add one by value.
				// Only the ledger keeps revisions, so its delta holds a hook's BigInt.
				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionAnswerOwner,
							primaryKeyType: 'string',
							meta: { accountability: null },
						},
						{
							collection: collectionAnswerRow,
							primaryKeyType: 'integer',
							meta: { accountability: null },
							fields: [
								{ field: 'name', type: 'string', meta: {} },
								{ field: 'status', type: 'string', meta: {} },
								{ field: 'amount', type: 'integer', meta: {} },
							],
						},
						{
							collection: collectionAnswerLedger,
							primaryKeyType: 'integer',
							meta: {},
							fields: [
								{ field: 'status', type: 'string', meta: {} },
								{ field: 'amount', type: 'bigInteger', meta: {} },
							],
						},
					],
				});

				await CreateFieldO2M(vendor, {
					collection: collectionAnswerOwner,
					field: 'rows',
					primaryKeyType: 'string',
					otherCollection: collectionAnswerRow,
					otherField: 'owner',
					relationMeta: { one_deselect_action: 'delete' },
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
