import { getUrl } from '@common/config';
import {
	CreateCollections,
	CreateField,
	CreateRelation,
	DeleteCollectionIfPresent,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect, it } from 'vitest';

export const collectionUserLink = 'test_write_user_link';

// The literal keys write-user-integrity.feature writes, dropped before it runs
// again. A delete by filter names only the rows it finds, so even a first run
// answers 204 (an admin's delete by keys answers 404 for a key no row holds).
const systemRowsByPath = {
	'/users': [
		'5e1f0000-0000-4000-8000-000000000011',
		'5e1f0000-0000-4000-8000-000000000012',
		'5e1f0000-0000-4000-8000-000000000013',
		'5e1f0000-0000-4000-8000-000000000014',
		'5e1f0000-0000-4000-8000-000000000015',
		'5e1f0000-0000-4000-8000-000000000016',
		'5e1f0000-0000-4000-8000-000000000017',
		'5e1f0000-0000-4000-8000-000000000018',
	],
	'/policies': ['5e1f0000-0000-4000-8000-000000000002'],
	'/roles': ['5e1f0000-0000-4000-8000-000000000001'],
};

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Users first: a role still holding a user cannot go before it.
				for (const [path, keys] of Object.entries(systemRowsByPath)) {
					const response = await request(getUrl(vendor))
						.delete(path)
						.set('Authorization', `Bearer ${USER.TESTS_FLOW.TOKEN}`)
						.send({ query: { filter: { id: { _in: keys } }, limit: -1 } });

					if (response.statusCode !== 204) {
						throw new Error(
							`Could not pre-clean ${path}: `
							+ `${response.statusCode} ${JSON.stringify(response.body)}`,
						);
					}
				}

				await DeleteCollectionIfPresent(vendor, { collection: collectionUserLink });

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionUserLink,
							primaryKeyType: 'string',
							fields: [
								{ field: 'target_collection', type: 'string', meta: {} },
							],
						},
					],
				});

				// An any-to-one field on the collection itself, reaching the users.
				await CreateField(vendor, {
					collection: collectionUserLink,
					field: 'target',
					type: 'string',
				});

				await CreateRelation(vendor, {
					collection: collectionUserLink,
					field: 'target',
					related_collection: null,
					meta: {
						one_allowed_collections: ['directus_users'],
						one_collection_field: 'target_collection',
					},
					schema: null,
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
