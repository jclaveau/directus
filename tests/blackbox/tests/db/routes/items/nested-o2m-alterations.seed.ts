import {
	CreateCollections,
	CreateFieldO2M,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionDeck = 'test_nested_o2m_deck';
export const collectionCard = 'test_nested_o2m_card';
export const collectionShelf = 'test_nested_o2m_shelf';
export const collectionBook = 'test_nested_o2m_book';
export const collectionBox = 'test_nested_o2m_box';
export const collectionBoxEntry = 'test_nested_o2m_box_entry';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: a child's FK blocks dropping its parent.
				for (const collection of [
					collectionCard,
					collectionDeck,
					collectionBook,
					collectionShelf,
					collectionBoxEntry,
					collectionBox,
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				// String keys, so a scenario names every row it writes and reads.
				await CreateCollections(vendor, {
					collections: [
						{ collection: collectionDeck, primaryKeyType: 'string' },
						{
							collection: collectionCard,
							primaryKeyType: 'string',
							fields: [{ field: 'sort', type: 'integer', meta: {} }],
						},
						{ collection: collectionShelf, primaryKeyType: 'string' },
						{
							collection: collectionBook,
							primaryKeyType: 'string',
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{ collection: collectionBox, primaryKeyType: 'string' },
						{ collection: collectionBoxEntry, primaryKeyType: 'string' },
					],
				});

				await CreateFieldO2M(vendor, {
					collection: collectionDeck,
					field: 'cards',
					primaryKeyType: 'string',
					otherCollection: collectionCard,
					otherField: 'deck',
					relationMeta: { sort_field: 'sort' },
				});

				await CreateFieldO2M(vendor, {
					collection: collectionShelf,
					field: 'books',
					primaryKeyType: 'string',
					otherCollection: collectionBook,
					otherField: 'shelf',
				});

				await CreateFieldO2M(vendor, {
					collection: collectionBox,
					field: 'entries',
					primaryKeyType: 'string',
					otherCollection: collectionBoxEntry,
					otherField: 'box',
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
