import {
	CreateCollections,
	CreateFieldM2O,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionArticle = 'test_mixed_cases_article';
export const collectionAuthor = 'test_mixed_cases_author';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: an article's FK blocks dropping its author.
				for (const collection of [collectionArticle, collectionAuthor]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				// String keys, so a scenario names every row it writes.
				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionAuthor,
							primaryKeyType: 'string',
							fields: [{ field: 'status', type: 'string', meta: {} }],
						},
						{
							collection: collectionArticle,
							primaryKeyType: 'string',
							fields: [
								{ field: 'title', type: 'string', meta: {} },
								{ field: 'secret', type: 'string', meta: {} },
							],
						},
					],
				});

				await CreateFieldM2O(vendor, {
					collection: collectionArticle,
					field: 'author',
					primaryKeyType: 'string',
					otherCollection: collectionAuthor,
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
