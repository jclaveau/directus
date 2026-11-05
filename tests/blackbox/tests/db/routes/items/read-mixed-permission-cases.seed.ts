import {
	CreateCollections,
	CreateFieldM2O,
	CreateRole,
	CreateUser,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { getUrl } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect, it } from 'vitest';

export const collectionArticle = 'test_mixed_cases_article';
export const collectionAuthor = 'test_mixed_cases_author';

const READER_ROLE = 'Read Mixed Permission Cases Role';
const OPEN_POLICY = 'Read Mixed Permission Cases Open Policy';
const AUTHOR_POLICY = 'Read Mixed Permission Cases Author Policy';

const AUTH = `Bearer ${USER.TESTS_FLOW.TOKEN}`;

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

				const role = await CreateRole(vendor, { name: READER_ROLE });

				await CreateUser(vendor, {
					token: 'ReadMixedPermissionCasesToken',
					email: 'read-mixed-permission-cases@default.com',
					password: 'read-mixed-permission-cases-password',
					roleName: READER_ROLE,
				});

				// A re-seed recreates the policies, so their permissions are not
				// doubled.
				for (const policyName of [OPEN_POLICY, AUTHOR_POLICY]) {
					const policiesResponse = await request(getUrl(vendor))
						.get('/policies')
						.query({ filter: { name: { _eq: policyName } }, fields: 'id' })
						.set('Authorization', AUTH);

					for (const { id } of policiesResponse.body.data) {
						const deleteResponse = await request(getUrl(vendor))
							.delete(`/policies/${id}`)
							.set('Authorization', AUTH);

						expect(deleteResponse.statusCode).toEqual(204);
					}
				}

				// Every article and author, but not the article's secret.
				const openPolicyResponse = await request(getUrl(vendor))
					.post('/policies')
					.send({
						name: OPEN_POLICY,
						app_access: false,
						admin_access: false,
						roles: [{ role: role.id }],
						permissions: [
							{
								collection: collectionArticle,
								action: 'read',
								fields: ['id', 'title'],
								permissions: {},
							},
							{
								collection: collectionAuthor,
								action: 'read',
								fields: ['*'],
								permissions: {},
							},
						],
					})
					.set('Authorization', AUTH);

				expect(openPolicyResponse.statusCode).toEqual(200);

				// The secret, only where the article's author is published.
				const authorPolicyResponse = await request(getUrl(vendor))
					.post('/policies')
					.send({
						name: AUTHOR_POLICY,
						app_access: false,
						admin_access: false,
						roles: [{ role: role.id }],
						permissions: [
							{
								collection: collectionArticle,
								action: 'read',
								fields: ['secret'],
								permissions: { author: { status: { _eq: 'published' } } },
							},
						],
					})
					.set('Authorization', AUTH);

				expect(authorPolicyResponse.statusCode).toEqual(200);
			}
			catch (error) {
				expect(error).toBeFalsy();
			}
		},
		300_000,
	);
};
