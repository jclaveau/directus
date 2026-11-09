import {
	CreateCollections,
	CreateFieldM2M,
	CreateFieldO2M,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

const ownerField = { field: 'owner', type: 'string', meta: {} };

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Children before parents: a child's FK blocks dropping its parent.
				for (const collection of [
					'test_nws_card',
					'test_nws_deck',
					'test_nws_post_tag',
					'test_nws_post',
					'test_nws_tag',
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				// String keys, so a scenario names every row it writes and reads.
				// Each child is scoped through its parent, as the planner's are.
				await CreateCollections(vendor, {
					collections: [
						{
							collection: 'test_nws_deck',
							primaryKeyType: 'string',
							meta: { scoped_cache_fields: ['owner'] },
							fields: [ownerField],
						},
						{
							collection: 'test_nws_card',
							primaryKeyType: 'string',
							meta: { scoped_cache_fields: ['deck.owner'] },
						},
						{
							collection: 'test_nws_post',
							primaryKeyType: 'string',
							meta: { scoped_cache_fields: ['owner'] },
							fields: [ownerField],
						},
						{ collection: 'test_nws_tag', primaryKeyType: 'string' },
						// Created ahead of CreateFieldM2M, which reuses it, so the
						// junction rows carry keys a scenario names too.
						{
							collection: 'test_nws_post_tag',
							primaryKeyType: 'string',
							meta: { scoped_cache_fields: ['test_nws_post_id.owner'] },
						},
					],
				});

				await CreateFieldO2M(vendor, {
					collection: 'test_nws_deck',
					field: 'cards',
					primaryKeyType: 'string',
					otherCollection: 'test_nws_card',
					otherField: 'deck',
				});

				await CreateFieldM2M(vendor, {
					collection: 'test_nws_post',
					field: 'tags',
					primaryKeyType: 'string',
					otherCollection: 'test_nws_tag',
					otherField: 'posts',
					junctionCollection: 'test_nws_post_tag',
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
