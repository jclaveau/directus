import {
	CreateCollections,
	CreateFieldO2M,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionArticle = 'test_quantifier_article';
export const collectionLink = 'test_quantifier_link';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: a child's FK blocks dropping its parent.
				for (const collection of [collectionLink, collectionArticle]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				// String keys, so a scenario names every row it writes.
				await CreateCollections(vendor, {
					collections: [
						{ collection: collectionArticle, primaryKeyType: 'string' },
						{
							collection: collectionLink,
							primaryKeyType: 'string',
							fields: [
								{ field: 'name', type: 'string', meta: {} },
								{ field: 'status', type: 'string', meta: {} },
							],
						},
					],
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
