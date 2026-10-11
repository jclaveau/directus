import {
	CreateCollection,
	CreateFieldM2O,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionRelationArticles = 'test_ws_relation_update_articles';
export const collectionRelationAuthors = 'test_ws_relation_update_authors';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			await DeleteCollection(vendor, { collection: collectionRelationArticles });
			await DeleteCollection(vendor, { collection: collectionRelationAuthors });

			await CreateCollection(vendor, { collection: collectionRelationAuthors });
			await CreateCollection(vendor, { collection: collectionRelationArticles });

			const relation = await CreateFieldM2O(vendor, {
				collection: collectionRelationArticles,
				field: 'author',
				otherCollection: collectionRelationAuthors,
				relationMeta: { one_deselect_action: 'nullify' },
			});

			expect(relation).toBeTruthy();
		},
		300_000,
	);
};
