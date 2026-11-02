import {
	CreateCollections,
	CreateFieldM2A,
	CreateFieldM2M,
	CreateFieldM2O,
	CreateFieldO2M,
	CreateItem,
	CreateRole,
	CreateUser,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { getUrl } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect, it } from 'vitest';

export const collectionArticle = 'test_read_counts_article';
export const collectionAuthor = 'test_read_counts_author';
export const collectionComment = 'test_read_counts_comment';
export const collectionTag = 'test_read_counts_tag';
export const collectionArticleTag = 'test_read_counts_article_tag';
export const collectionQuote = 'test_read_counts_quote';
export const collectionArticleBlock = 'test_read_counts_article_block';

const READER_ROLE = 'Read Statement Counts Role';
const READER_POLICY = 'Read Statement Counts Policy';

const AUTH = `Bearer ${USER.TESTS_FLOW.TOKEN}`;

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			try {
				// Junctions and children before the rows they point at.
				for (const collection of [
					collectionArticleBlock,
					collectionArticleTag,
					collectionComment,
					collectionArticle,
					collectionAuthor,
					collectionTag,
					collectionQuote,
				]) {
					await DeleteCollectionIfPresent(vendor, { collection });
				}

				await CreateCollections(vendor, {
					collections: [
						{
							collection: collectionAuthor,
							primaryKeyType: 'string',
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							collection: collectionTag,
							primaryKeyType: 'string',
							fields: [{ field: 'name', type: 'string', meta: {} }],
						},
						{
							collection: collectionQuote,
							primaryKeyType: 'string',
							fields: [{ field: 'text', type: 'string', meta: {} }],
						},
						{
							collection: collectionArticle,
							primaryKeyType: 'string',
							fields: [
								{ field: 'title', type: 'string', meta: {} },
								{ field: 'status', type: 'string', meta: {} },
							],
						},
						{
							collection: collectionComment,
							primaryKeyType: 'string',
							fields: [{ field: 'body', type: 'string', meta: {} }],
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
					field: 'comments',
					primaryKeyType: 'string',
					otherCollection: collectionComment,
					otherField: 'article',
				});

				await CreateFieldM2M(vendor, {
					collection: collectionArticle,
					field: 'tags',
					primaryKeyType: 'string',
					otherCollection: collectionTag,
					otherField: 'articles',
					junctionCollection: collectionArticleTag,
				});

				await CreateFieldM2A(vendor, {
					collection: collectionArticle,
					field: 'blocks',
					primaryKeyType: 'string',
					relatedCollections: [collectionQuote],
					junctionCollection: collectionArticleBlock,
				});

				await CreateItem(vendor, {
					collection: collectionAuthor,
					item: [
						{ id: 'ada', name: 'Ada' },
						{ id: 'bob', name: 'Bob' },
					],
				});

				await CreateItem(vendor, {
					collection: collectionTag,
					item: [
						{ id: 'perf', name: 'Perf' },
						{ id: 'sql', name: 'SQL' },
					],
				});

				await CreateItem(vendor, {
					collection: collectionQuote,
					item: [{ id: 'q1', text: 'Measure first' }],
				});

				await CreateItem(vendor, {
					collection: collectionArticle,
					item: [
						{
							id: 'first',
							title: 'First',
							status: 'published',
							author: 'ada',
							comments: [
								{ id: 'c1', body: 'Nice' },
								{ id: 'c2', body: 'More' },
							],
							tags: [
								{ [`${collectionTag}_id`]: 'perf' },
								{ [`${collectionTag}_id`]: 'sql' },
							],
							blocks: [{ collection: collectionQuote, item: 'q1' }],
						},
						{
							id: 'second',
							title: 'Second',
							status: 'published',
							author: 'bob',
							tags: [{ [`${collectionTag}_id`]: 'perf' }],
						},
						{
							id: 'third',
							title: 'Third',
							status: 'draft',
							author: 'ada',
						},
					],
				});

				const role = await CreateRole(vendor, { name: READER_ROLE });

				await CreateUser(vendor, {
					token: 'ReadStatementCountsToken',
					email: 'read-statement-counts@default.com',
					roleName: READER_ROLE,
				});

				// A re-seed recreates the policy, so its permissions are not doubled.
				const policiesResponse = await request(getUrl(vendor))
					.get('/policies')
					.query({ filter: { name: { _eq: READER_POLICY } }, fields: 'id' })
					.set('Authorization', AUTH);

				for (const { id } of policiesResponse.body.data) {
					const deleteResponse = await request(getUrl(vendor))
						.delete(`/policies/${id}`)
						.set('Authorization', AUTH);

					expect(deleteResponse.statusCode).toEqual(204);
				}

				const policyResponse = await request(getUrl(vendor))
					.post('/policies')
					.send({
						name: READER_POLICY,
						app_access: false,
						admin_access: false,
						roles: [{ role: role.id }],
						permissions: [
							{
								collection: collectionArticle,
								action: 'read',
								fields: ['*'],
								permissions: { status: { _eq: 'published' } },
							},
							...[
								collectionAuthor,
								collectionComment,
								collectionTag,
								collectionArticleTag,
								collectionQuote,
								collectionArticleBlock,
							].map((collection) => {
								return {
									collection,
									action: 'read',
									fields: ['*'],
									permissions: {},
								};
							}),
						],
					})
					.set('Authorization', AUTH);

				expect(policyResponse.statusCode).toEqual(200);
			}
			catch (error) {
				expect(error).toBeFalsy();
			}
		},
		300_000,
	);
};
