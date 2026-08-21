import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2M,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import knex from 'knex';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// End-to-end witness for what a create-filter hook may do to the scoped cache (#292)
// on the real M2M flow it exists for: a parent update nests related links
// (`authors.create`), and Directus turns each into a create on the junction — not a
// direct pivot write. A hook that takes over a junction row (returns an existing PK)
// is scoped COARSE by default: a take-over can be an upsert that MOVES a row between
// slices, which the create path can't recover, so a narrow guess would leak the old
// slice. A hook that knows its footprint opts into a precise purge via
// `scopedCache.purgeBy` — and a hook that VETOES a row (returns null) purges nothing
// unless it declares, since a pure veto changed nothing.
//
// On a scoped-purge redis instance (the only mode where the diff shows), each slice
// read via `x-cache-status` HIT/MISS:
//
//   - article —< article_author >— author, a DECLARED read-only dedup hook → narrow:
//     only the updated article's slice is purged, a sibling article stays warm.
//   - post —< post_tag >— tag, an UNDECLARED move hook (re-assigns the link to a new
//     post) → coarse: the moved-from post's slice is purged, so it can't go stale.
//   - moderated (flat, channel-scoped), a create hook that VETOES a row: a pure veto
//     purges nothing; a veto that declares its slice via `purgeBy` purges precisely.
//   - inert_dedup (flat, channel-scoped), a take-over that writes NOTHING and says
//     so via `skipPurgeFor` → purges nothing: both channel slices stay warm.

const ARTICLE = 'test_items_article';
const AUTHOR = 'test_items_author';
const ARTICLE_AUTHOR = 'test_items_article_author';
const ARTICLE_FK = 'test_items_article_id';
const AUTHOR_FK = 'test_items_author_id';

const POST = 'test_items_post';
const TAG = 'test_items_tag';
const POST_TAG = 'test_items_post_tag';
const POST_FK = 'test_items_post_id';
const TAG_FK = 'test_items_tag_id';

const MODERATED = 'test_items_moderated';
const INERT_DEDUP = 'test_items_inert_dedup';

const COLLECTIONS = 'directus_collections';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	create-hook cache scope: take-over coarse-by-default / narrow-when-declared, veto
	purges nothing unless declared (#292)
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-m2m-takeover-${vendor}`;

		let instance: ChildProcess;
		let ada: number;
		let bob: number;
		let cal: number;
		let dbGuide: number;
		let mlGuide: number;
		let news: number;
		let launch: number;
		let recap: number;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns, so it sees
			// the junctions (+ their `scoped_cache_fields` meta) on boot. Base collections
			// get an auto integer PK; CreateFieldM2M adds each junction and its two FKs.
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ARTICLE,
						fields: [{ field: 'title', type: 'string', meta: {} }],
					},
					{
						collection: AUTHOR,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: POST,
						fields: [{ field: 'title', type: 'string', meta: {} }],
					},
					{
						collection: TAG,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: MODERATED,
						meta: { scoped_cache_fields: ['channel'] },
						fields: [
							{ field: 'channel', type: 'string', meta: {} },
							{ field: 'body', type: 'string', meta: {} },
						],
					},
					{
						collection: INERT_DEDUP,
						meta: { scoped_cache_fields: ['channel'] },
						fields: [
							{ field: 'channel', type: 'string', meta: {} },
							{ field: 'body', type: 'string', meta: {} },
						],
					},
				],
			});

			// Schema DDL is serialised to avoid concurrent-migration races.
			await CreateFieldM2M(vendor, {
				collection: ARTICLE,
				field: 'authors',
				otherCollection: AUTHOR,
				otherField: 'articles',
				junctionCollection: ARTICLE_AUTHOR,
			});

			await CreateFieldM2M(vendor, {
				collection: POST,
				field: 'tags',
				otherCollection: TAG,
				otherField: 'posts',
				junctionCollection: POST_TAG,
			});

			// A real M2M pivot carries UNIQUE(left, right); the take-over returns the
			// existing row on a duplicate rather than hit it. Add it via knex (the fields
			// API has no composite-unique), and scope each junction by its left FK — the
			// slice a nested link touches. Neither is expressible through CreateFieldM2M.
			const db = knex(config.knexConfig[vendor]!);

			try {
				await Promise.all([
					db.schema.alterTable(ARTICLE_AUTHOR, (table) => {
						table.unique([ARTICLE_FK, AUTHOR_FK]);
					}),
					db.schema.alterTable(POST_TAG, (table) => {
						table.unique([POST_FK, TAG_FK]);
					}),
				]);

				await Promise.all([
					db(COLLECTIONS)
						.where({ collection: ARTICLE_AUTHOR })
						.update({ scoped_cache_fields: JSON.stringify([ARTICLE_FK]) }),
					db(COLLECTIONS)
						.where({ collection: POST_TAG })
						.update({ scoped_cache_fields: JSON.stringify([POST_FK]) }),
				]);
			}
			finally {
				await db.destroy();
			}

			// Independent seeds (distinct collections) → one round-trip.
			const [authors, articles, tags, posts] = await Promise.all([
				CreateItem(vendor, {
					collection: AUTHOR,
					item: [{ name: 'ada' }, { name: 'bob' }, { name: 'cal' }],
				}),
				CreateItem(vendor, {
					collection: ARTICLE,
					item: [{ title: 'db-guide' }, { title: 'ml-guide' }],
				}),
				CreateItem(vendor, { collection: TAG, item: [{ name: 'news' }] }),
				CreateItem(vendor, {
					collection: POST,
					item: [{ title: 'launch' }, { title: 'recap' }],
				}),
				CreateItem(vendor, {
					collection: MODERATED,
					item: [
						{ channel: 'general', body: 'hello' },
						{ channel: 'random', body: 'hi' },
					],
				}),
				CreateItem(vendor, {
					collection: INERT_DEDUP,
					item: [
						{ channel: 'general', body: 'hello' },
						{ channel: 'random', body: 'hi' },
					],
				}),
			]);

			[ada, bob, cal] = authors.map((author: { id: number }) => author.id);
			[dbGuide, mlGuide] = articles.map((article: { id: number }) => article.id);
			[news] = tags.map((tag: { id: number }) => tag.id);
			[launch, recap] = posts.map((post: { id: number }) => post.id);

			// Link db-guide↔{ada, bob} and ml-guide↔ada; launch↔news. Distinct pairs, so
			// the dedup/move hooks no-op on these first inserts.
			await Promise.all([
				CreateItem(vendor, {
					collection: ARTICLE_AUTHOR,
					item: [
						{ [ARTICLE_FK]: dbGuide, [AUTHOR_FK]: ada },
						{ [ARTICLE_FK]: dbGuide, [AUTHOR_FK]: bob },
						{ [ARTICLE_FK]: mlGuide, [AUTHOR_FK]: ada },
					],
				}),
				CreateItem(vendor, {
					collection: POST_TAG,
					item: [{ [POST_FK]: launch, [TAG_FK]: news }],
				}),
			]);

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
		}, 120_000);

		afterAll(async () => {
			instance.kill();

			await Promise.all([
				DeleteCollection(vendor, { collection: ARTICLE_AUTHOR }),
				DeleteCollection(vendor, { collection: POST_TAG }),
			]);

			await Promise.all([
				DeleteCollection(vendor, { collection: ARTICLE }),
				DeleteCollection(vendor, { collection: AUTHOR }),
				DeleteCollection(vendor, { collection: POST }),
				DeleteCollection(vendor, { collection: TAG }),
				DeleteCollection(vendor, { collection: MODERATED }),
				DeleteCollection(vendor, { collection: INERT_DEDUP }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readSlice(collection: string, field: string, value: number | string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.query({ [`filter[${field}][_eq]`]: value })
				.set('Authorization', auth);
		}

		it(oneLine`
			a DECLARED read-only dedup take-over on a nested M2M link narrows to the
			updated article, leaving a sibling article's slice warm
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm both article slices (independent reads).
			await Promise.all([
				readSlice(ARTICLE_AUTHOR, ARTICLE_FK, dbGuide),
				readSlice(ARTICLE_AUTHOR, ARTICLE_FK, mlGuide),
			]);

			// Update db-guide's authors with an already-linked author (ada) + a new one
			// (cal). The nested create links both through the junction: (db-guide, ada)
			// exists, so the dedup takes it over and declares db-guide's slice;
			// (db-guide, cal) is a fresh link. A plain insert of the ada pair would
			// violate UNIQUE and 500, so a 200 proves the dedup ran.
			const patched = await request(url)
				.patch(`/items/${ARTICLE}/${dbGuide}`)
				.send({
					authors: {
						create: [{ [AUTHOR_FK]: ada }, { [AUTHOR_FK]: cal }],
						update: [],
						delete: [],
					},
				})
				.set('Authorization', auth);

			expect(patched.statusCode).toBe(200);

			const [dbSlice, mlSlice] = await Promise.all([
				readSlice(ARTICLE_AUTHOR, ARTICLE_FK, dbGuide),
				readSlice(ARTICLE_AUTHOR, ARTICLE_FK, mlGuide),
			]);

			expect(dbSlice.headers[cacheStatusHeader]).toBe('MISS');
			expect(mlSlice.headers[cacheStatusHeader]).toBe('HIT');

			// Functional: the ada pair was deduped, not duplicated — db-guide links
			// exactly its three distinct authors, and untouched ml-guide keeps its one.
			const dbAuthors = dbSlice.body.data
				.map((row: Record<string, number>) => row[AUTHOR_FK])
				.sort((a: number, b: number) => a - b);

			expect(dbAuthors).toEqual([ada, bob, cal].sort((a, b) => a - b));
			expect(mlSlice.body.data).toHaveLength(1);
		});

		it(oneLine`
			an UNDECLARED move take-over on a nested M2M link purges coarse — the
			moved-from post's slice is dropped, so it cannot serve a stale link
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm launch's slice — it holds the news link.
			const launchBefore = await readSlice(POST_TAG, POST_FK, launch);
			expect(launchBefore.body.data).toHaveLength(1);

			// Link news to recap: the move hook finds the existing (launch, news) link
			// and re-assigns it to recap, returning its PK. Declares nothing → coarse.
			await request(url)
				.patch(`/items/${POST}/${recap}`)
				.send({
					tags: {
						create: [{ [TAG_FK]: news }],
						update: [],
						delete: [],
					},
				})
				.set('Authorization', auth);

			const [launchSlice, recapSlice] = await Promise.all([
				readSlice(POST_TAG, POST_FK, launch),
				readSlice(POST_TAG, POST_FK, recap),
			]);

			// Coarse purge dropped launch's slice: a re-read MISSes and returns nothing —
			// the link moved to recap. A narrow (new-slice-only) purge would leave launch
			// stale.
			expect(launchSlice.headers[cacheStatusHeader]).toBe('MISS');
			expect(launchSlice.body.data).toHaveLength(0);
			expect(recapSlice.body.data).toHaveLength(1);
		});

		it(oneLine`
			a create hook that VETOES a row (returns null) purges nothing — the vetoed
			row's channel slice stays warm
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm both channel slices (independent reads).
			await Promise.all([
				readSlice(MODERATED, 'channel', 'general'),
				readSlice(MODERATED, 'channel', 'random'),
			]);

			// Post a 'spam' body into general: the hook vetoes it (returns null) and
			// declares nothing. A cancelled create changed nothing, so it must purge
			// nothing — data null proves the veto, 200 that it wasn't an error.
			const vetoed = await request(url)
				.post(`/items/${MODERATED}`)
				.send({ channel: 'general', body: 'spam' })
				.set('Authorization', auth);

			expect(vetoed.statusCode).toBe(200);
			expect(vetoed.body.data).toBeNull();

			const [general, random] = await Promise.all([
				readSlice(MODERATED, 'channel', 'general'),
				readSlice(MODERATED, 'channel', 'random'),
			]);

			// Nothing purged: both slices still warm, and the veto persisted no row.
			expect(general.headers[cacheStatusHeader]).toBe('HIT');
			expect(random.headers[cacheStatusHeader]).toBe('HIT');
			expect(general.body.data).toHaveLength(1);
		});

		it(oneLine`
			a take-over that wrote nothing and says so purges nothing — both channel
			slices stay warm
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const warmed = await Promise.all([
				readSlice(INERT_DEDUP, 'channel', 'general'),
				readSlice(INERT_DEDUP, 'channel', 'random'),
			]);

			// Non-vacuity: a cold read would make the HITs below meaningless.
			for (const response of warmed) {
				expect(response.headers[cacheStatusHeader]).toBe('MISS');
			}

			// Byte-for-byte the row already stored, so the hook takes the create over
			// and writes nothing. Undeclared this would be COARSE — the sibling
			// channel is what proves it is not.
			const taken = await request(url)
				.post(`/items/${INERT_DEDUP}`)
				.send({ channel: 'general', body: 'hello' })
				.set('Authorization', auth);

			expect(taken.statusCode).toBe(200);

			const [general, random] = await Promise.all([
				readSlice(INERT_DEDUP, 'channel', 'general'),
				readSlice(INERT_DEDUP, 'channel', 'random'),
			]);

			expect(general.headers[cacheStatusHeader]).toBe('HIT');
			expect(random.headers[cacheStatusHeader]).toBe('HIT');

			// The take-over really happened: no duplicate row landed.
			expect(general.body.data).toHaveLength(1);
		});

		it(oneLine`
			a VETO that declares its slice via purgeBy purges precisely — the declared
			channel MISSes, a sibling stays warm
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await Promise.all([
				readSlice(MODERATED, 'channel', 'general'),
				readSlice(MODERATED, 'channel', 'random'),
			]);

			// Post a 'flagged' body: the hook declares general's slice via purgeBy, then
			// vetoes the row. The veto persists nothing, but the declaration still fires
			// the precise purge — the escape hatch a side-effecting veto would use.
			const vetoed = await request(url)
				.post(`/items/${MODERATED}`)
				.send({ channel: 'general', body: 'flagged' })
				.set('Authorization', auth);

			expect(vetoed.body.data).toBeNull();

			const [general, random] = await Promise.all([
				readSlice(MODERATED, 'channel', 'general'),
				readSlice(MODERATED, 'channel', 'random'),
			]);

			// Declared purge dropped general only; random stays warm; still no row added.
			expect(general.headers[cacheStatusHeader]).toBe('MISS');
			expect(random.headers[cacheStatusHeader]).toBe('HIT');
			expect(general.body.data).toHaveLength(1);
		});
	});
});
