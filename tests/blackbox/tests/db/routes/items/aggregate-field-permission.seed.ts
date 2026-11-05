import {
	CreateCollections,
	CreateFieldM2O,
	CreateFieldO2M,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionAuthor = 'test_agg_field_author';
export const collectionArticle = 'test_agg_field_article';
export const collectionLink = 'test_agg_field_link';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: a child's FK blocks dropping its parent.
				for (const collection of [
					collectionLink,
					collectionArticle,
					collectionAuthor,
				]) {
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
								{ field: 'category', type: 'string', meta: {} },
								{ field: 'salary', type: 'integer', meta: {} },
							],
						},
						{
							collection: collectionLink,
							primaryKeyType: 'string',
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
					],
				});

				await CreateFieldM2O(vendor, {
					collection: collectionArticle,
					field: 'author',
					primaryKeyType: 'string',
					otherCollection: collectionAuthor,
				});

				await CreateFieldO2M(vendor, {
					collection: collectionArticle,
					field: 'links',
					primaryKeyType: 'string',
					otherCollection: collectionLink,
					otherField: 'article',
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
