import { CreateCollections, DeleteCollectionIfPresent } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { expect, it } from 'vitest';

export const collectionDraftPosts = 'test_wp_draft_posts';
export const collectionDraftBanner = 'test_wp_draft_banner';

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				await DeleteCollectionIfPresent(vendor, {
					collection: collectionDraftPosts,
				});

				await DeleteCollectionIfPresent(vendor, {
					collection: collectionDraftBanner,
				});

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionDraftPosts,
							meta: { versioning: true },
							fields: [
								{ field: 'title', type: 'string', meta: {} },
								{ field: 'summary', type: 'string', meta: {} },
							],
							primaryKeyType: 'string',
						},
						{
							collection: collectionDraftBanner,
							meta: { singleton: true, versioning: true },
							fields: [{ field: 'title', type: 'string', meta: {} }],
						},
					],
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
