import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
	CreateFieldO2M,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// An article nests `comment` twice: through its `featured_comment` M2O and through
// its `comments` O2M. The O2M's reverse fk pins `comment:article=<article>`, which
// names only the rows that path nested — the featured comment belongs to another
// article and no write to it reproduces that pin.
const ARTICLE = 'twice_article';
const COMMENT = 'twice_comment';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a collection nested through an M2O path and an O2M path stays bare
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-o2m-and-m2o-same-coll-${vendor}`;

		let instance: ChildProcess;
		let readArticleId: number;
		let featuredCommentId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ARTICLE,
						fields: [{ field: 'title', type: 'string', meta: {} }],
					},
					{
						collection: COMMENT,
						meta: { scoped_cache_fields: ['article'] },
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldO2M(vendor, {
				collection: ARTICLE,
				field: 'comments',
				otherCollection: COMMENT,
				otherField: 'article',
			});

			await CreateFieldM2O(vendor, {
				collection: ARTICLE,
				field: 'featured_comment',
				otherCollection: COMMENT,
			});

			const articles = await CreateItem(vendor, {
				collection: ARTICLE,
				item: [{ title: 'read' }, { title: 'other' }],
			});

			readArticleId = articles[0].id;

			const comments = await CreateItem(vendor, {
				collection: COMMENT,
				item: [
					{ body: 'featured', article: articles[1].id },
					{ body: 'own', article: readArticleId },
				],
			});

			featuredCommentId = comments[0].id;

			// Asserted: read back 100 lines below, a seed PATCH that did not land
			// surfaces as a null `featured_comment` and reads as a cache bug.
			await request(getUrl(vendor))
				.patch(`/items/${ARTICLE}/${readArticleId}`)
				.send({ featured_comment: featuredCommentId })
				.set('Authorization', auth)
				.expect(200);

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance.kill();

			await DeleteCollection(vendor, { collection: ARTICLE });
			await DeleteCollection(vendor, { collection: COMMENT });
		});

		function readArticle() {
			return request(getUrl(vendor, env))
				.get(`/items/${ARTICLE}/${readArticleId}`)
				.query({ fields: 'title,featured_comment.body,comments.body' })
				.set('Authorization', auth);
		}

		function updateFeaturedComment(body: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${COMMENT}/${featuredCommentId}`)
				.send({ body })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it('does not let the O2M reverse-fk pin stand for the M2O row', async () => {
			const tags = (await readArticle()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${COMMENT}(,|$)`));

			expect(tags).not.toMatch(
				new RegExp(`(^|, )${COMMENT}:article=${readArticleId}(,|$)`),
			);
		});

		it(oneLine`
			a write to the featured comment of another article evicts the read
		`, async () => {
			await clearCache();

			expect((await readArticle()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readArticle()).headers[cacheStatusHeader]).toBe('HIT');

			await updateFeaturedComment('featured, edited');

			const after = await readArticle();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data.featured_comment.body).toBe('featured, edited');
		});
	});
});
