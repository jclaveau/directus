import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateField,
	CreateFieldM2A,
	CreateFieldM2M,
	CreateFieldM2O,
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
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

// A fingerprint's view is every column a write can change the answer through,
// and some of them are named by nothing in `fields=`: the filter a permission case
// adds, the columns a `search=` matches, the column an A2O reads its collection
// from. Each case writes one column outside the view and one inside it, so the
// HIT proves the view is narrow and the MISS proves it holds that column.
const ARTICLE = 'composite_view_article';
const NOTE = 'composite_view_note';
const PAGE = 'composite_view_page';
const BLOCK = 'composite_view_block';
const TEXT = 'composite_view_text';
const IMAGE = 'composite_view_image';
const SHELF = 'composite_view_shelf';
const LABEL = 'composite_view_label';
const SHELF_LABEL = 'composite_view_shelf_label';
const PROJECT = 'composite_view_project';
const TASK = 'composite_view_task';

const cacheStatusHeader = 'x-cache-status';

describe.each(vendors)('%s', (vendor) => {
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = `directus-composite-view-${vendor}`;

	let instance: ChildProcess;
	const userToken = `composite-view-${vendor}-00000000000000000`;
	const admin = `Bearer ${USER.ADMIN.TOKEN}`;
	const asUser = `Bearer ${userToken}`;

	let articleId: number;
	let firstNoteId: number;
	let secondNoteId: number;
	let firstPageId: number;
	let sparePageId: number;
	let switchBlockId: number;
	let firstTextId: number;
	let switchTextId: number;
	let shelfId: number;
	let redLabelId: number;
	let blueLabelId: number;
	let taskId: number;
	let apolloId: number;
	let geminiId: number;

	async function readItems(
		collection: string,
		query: Record<string, string>,
		authorization: string = admin,
	) {
		return request(getUrl(vendor, env))
			.get(`/items/${collection}`)
			.query(query)
			.set('Authorization', authorization);
	}

	async function updateItem(
		collection: string,
		primaryKey: number,
		data: Record<string, unknown>,
	) {
		const response = await request(getUrl(vendor, env))
			.patch(`/items/${collection}/${primaryKey}`)
			.send(data)
			.set('Authorization', admin);

		expect(response.statusCode).toBe(200);
	}

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{
					collection: ARTICLE,
					fields: [
						{ field: 'title', type: 'string', meta: {} },
						{ field: 'status', type: 'string', meta: {} },
						{ field: 'body', type: 'string', meta: {} },
					],
				},
				{
					collection: NOTE,
					fields: [
						{ field: 'title', type: 'string', meta: {} },
						{ field: 'flag', type: 'boolean', meta: {} },
					],
				},
				{
					collection: PAGE,
					fields: [{ field: 'name', type: 'string', meta: {} }],
				},
				{
					collection: TEXT,
					fields: [
						{ field: 'body', type: 'string', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
					],
				},
				{
					collection: IMAGE,
					fields: [{ field: 'caption', type: 'string', meta: {} }],
				},
				{
					collection: SHELF,
					fields: [{ field: 'name', type: 'string', meta: {} }],
				},
				{
					collection: LABEL,
					fields: [
						{ field: 'name', type: 'string', meta: {} },
						{ field: 'color', type: 'string', meta: {} },
					],
				},
				{
					collection: PROJECT,
					fields: [{ field: 'name', type: 'string', meta: {} }],
				},
				{
					collection: TASK,
					fields: [{ field: 'title', type: 'string', meta: {} }],
				},
			],
		});

		await CreateFieldM2A(vendor, {
			collection: PAGE,
			field: 'blocks',
			relatedCollections: [TEXT, IMAGE],
			junctionCollection: BLOCK,
		});

		await CreateField(vendor, {
			collection: BLOCK,
			field: 'position',
			type: 'integer',
		});

		await CreateFieldM2M(vendor, {
			collection: SHELF,
			field: 'labels',
			otherCollection: LABEL,
			otherField: 'shelves',
			junctionCollection: SHELF_LABEL,
		});

		await CreateFieldM2O(vendor, {
			collection: TASK,
			field: 'project',
			otherCollection: PROJECT,
		});

		const userResponse = await request(getUrl(vendor, env))
			.post('/users')
			.set('Authorization', admin)
			.send({
				first_name: 'composite view user',
				token: userToken,
				policies: {
					create: [{
						policy: {
							name: 'composite view policy',
							app_access: true,
							permissions: {
								create: [{
									policy: '+',
									permissions: { status: { _eq: 'published' } },
									validation: null,
									fields: ['*'],
									presets: null,
									collection: ARTICLE,
									action: 'read',
								}],
								update: [],
								delete: [],
							},
						},
					}],
					update: [],
					delete: [],
				},
			});

		expect(userResponse.statusCode).toBe(200);

		articleId = (await CreateItem(vendor, {
			collection: ARTICLE,
			item: { title: 'launch', status: 'published', body: 'first body' },
		})).id;

		firstNoteId = (await CreateItem(vendor, {
			collection: NOTE,
			item: { title: 'news one', flag: false },
		})).id;

		secondNoteId = (await CreateItem(vendor, {
			collection: NOTE,
			item: { title: 'weather', flag: false },
		})).id;

		firstPageId = (await CreateItem(vendor, {
			collection: PAGE,
			item: { name: 'home' },
		})).id;

		sparePageId = (await CreateItem(vendor, {
			collection: PAGE,
			item: { name: 'spare' },
		})).id;

		firstTextId = (await CreateItem(vendor, {
			collection: TEXT,
			item: { body: 'hello', note: 'first note' },
		})).id;

		switchTextId = (await CreateItem(vendor, {
			collection: TEXT,
			item: { body: 'before the switch', note: 'second note' },
		})).id;

		// The image shares the text's key, so moving the junction row's `collection`
		// alone points the same `item` at the image.
		await CreateItem(vendor, {
			collection: IMAGE,
			item: { id: switchTextId, caption: 'sunset' },
		});

		await CreateItem(vendor, {
			collection: BLOCK,
			item: {
				[`${BLOCK}_id`]: firstPageId,
				item: String(firstTextId),
				collection: TEXT,
				position: 1,
			},
		});

		switchBlockId = (await CreateItem(vendor, {
			collection: BLOCK,
			item: {
				[`${BLOCK}_id`]: sparePageId,
				item: String(switchTextId),
				collection: TEXT,
				position: 1,
			},
		})).id;

		shelfId = (await CreateItem(vendor, {
			collection: SHELF,
			item: { name: 'reading' },
		})).id;

		redLabelId = (await CreateItem(vendor, {
			collection: LABEL,
			item: { name: 'red tag', color: 'red' },
		})).id;

		blueLabelId = (await CreateItem(vendor, {
			collection: LABEL,
			item: { name: 'blue tag', color: 'blue' },
		})).id;

		await CreateItem(vendor, {
			collection: SHELF_LABEL,
			item: { [`${SHELF}_id`]: shelfId, [`${LABEL}_id`]: redLabelId },
		});

		apolloId = (await CreateItem(vendor, {
			collection: PROJECT,
			item: { name: 'apollo' },
		})).id;

		geminiId = (await CreateItem(vendor, {
			collection: PROJECT,
			item: { name: 'gemini' },
		})).id;

		taskId = (await CreateItem(vendor, {
			collection: TASK,
			item: { title: 'launch prep', project: apolloId },
		})).id;

		const port = await getPort();
		env[vendor].PORT = String(port);

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);
	}, 120_000);

	beforeEach(async () => {
		const cleared = await request(getUrl(vendor, env))
			.post('/utils/cache/clear')
			.set('Authorization', admin);

		expect(cleared.statusCode).toBe(200);
	});

	afterAll(async () => {
		instance.kill();

		for (const collection of [
			BLOCK,
			TEXT,
			IMAGE,
			PAGE,
			SHELF_LABEL,
			LABEL,
			SHELF,
			TASK,
			PROJECT,
			ARTICLE,
			NOTE,
		]) {
			await DeleteCollection(vendor, { collection });
		}
	});

	it(oneLine`
		purges a read on a write to the field its permission case filters by,
		which the read never selected
	`, async () => {
		const query = { fields: 'id,title' };

		expect((await readItems(ARTICLE, query, asUser)).headers[cacheStatusHeader])
			.toBe('MISS');

		expect((await readItems(ARTICLE, query, asUser)).headers[cacheStatusHeader])
			.toBe('HIT');

		await updateItem(ARTICLE, articleId, { body: 'second body' });

		const afterBody = await readItems(ARTICLE, query, asUser);

		expect(afterBody.headers[cacheStatusHeader]).toBe('HIT');
		expect(afterBody.body.data).toEqual([{ id: articleId, title: 'launch' }]);

		await updateItem(ARTICLE, articleId, { status: 'draft' });

		const afterStatus = await readItems(ARTICLE, query, asUser);

		expect(afterStatus.headers[cacheStatusHeader]).toBe('MISS');
		expect(afterStatus.body.data).toEqual([]);
	});

	it(oneLine`
		purges a searching read on a write to a column the search matches
	`, async () => {
		const query = { fields: 'id', search: 'news', sort: 'id' };

		expect((await readItems(NOTE, query)).headers[cacheStatusHeader])
			.toBe('MISS');

		expect((await readItems(NOTE, query)).headers[cacheStatusHeader])
			.toBe('HIT');

		await updateItem(NOTE, firstNoteId, { flag: true });

		const afterFlag = await readItems(NOTE, query);

		expect(afterFlag.headers[cacheStatusHeader]).toBe('HIT');
		expect(afterFlag.body.data).toEqual([{ id: firstNoteId }]);

		await updateItem(NOTE, secondNoteId, { title: 'news two' });

		const afterTitle = await readItems(NOTE, query);

		expect(afterTitle.headers[cacheStatusHeader]).toBe('MISS');

		expect(afterTitle.body.data).toEqual([
			{ id: firstNoteId },
			{ id: secondNoteId },
		]);
	});

	it(oneLine`
		purges an A2O read on a write to the junction's collection column alone
	`, async () => {
		const query = {
			'fields': `id,item:${TEXT}.body,item:${IMAGE}.caption`,
			'filter[id][_eq]': String(switchBlockId),
		};

		expect((await readItems(BLOCK, query)).headers[cacheStatusHeader])
			.toBe('MISS');

		const cachedBlock = await readItems(BLOCK, query);

		expect(cachedBlock.headers[cacheStatusHeader]).toBe('HIT');

		expect(cachedBlock.body.data).toEqual([
			{ id: switchBlockId, item: { body: 'before the switch' } },
		]);

		await updateItem(BLOCK, switchBlockId, { position: 2 });

		expect((await readItems(BLOCK, query)).headers[cacheStatusHeader])
			.toBe('HIT');

		await updateItem(BLOCK, switchBlockId, { collection: IMAGE });

		const afterCollection = await readItems(BLOCK, query);

		expect(afterCollection.headers[cacheStatusHeader]).toBe('MISS');

		expect(afterCollection.body.data).toEqual([
			{ id: switchBlockId, item: { caption: 'sunset' } },
		]);
	});

	it(oneLine`
		purges an m2a read on a write to the column it reads past the junction
	`, async () => {
		const query = {
			'fields': `id,blocks.item:${TEXT}.body`,
			'filter[id][_eq]': String(firstPageId),
		};

		expect((await readItems(PAGE, query)).headers[cacheStatusHeader])
			.toBe('MISS');

		expect((await readItems(PAGE, query)).headers[cacheStatusHeader])
			.toBe('HIT');

		await updateItem(TEXT, firstTextId, { note: 'edited note' });

		const afterNote = await readItems(PAGE, query);

		expect(afterNote.headers[cacheStatusHeader]).toBe('HIT');

		expect(afterNote.body.data).toEqual([
			{ id: firstPageId, blocks: [{ item: { body: 'hello' } }] },
		]);

		await updateItem(TEXT, firstTextId, { body: 'hello again' });

		const afterBody = await readItems(PAGE, query);

		expect(afterBody.headers[cacheStatusHeader]).toBe('MISS');

		expect(afterBody.body.data).toEqual([
			{ id: firstPageId, blocks: [{ item: { body: 'hello again' } }] },
		]);
	});

	it(oneLine`
		purges an m2m read only on a write to the label it shows, in a column it
		selected
	`, async () => {
		const query = {
			'fields': `id,labels.${LABEL}_id.name`,
			'filter[id][_eq]': String(shelfId),
		};

		expect((await readItems(SHELF, query)).headers[cacheStatusHeader])
			.toBe('MISS');

		expect((await readItems(SHELF, query)).headers[cacheStatusHeader])
			.toBe('HIT');

		await updateItem(LABEL, redLabelId, { color: 'crimson' });

		expect((await readItems(SHELF, query)).headers[cacheStatusHeader])
			.toBe('HIT');

		await updateItem(LABEL, blueLabelId, { name: 'navy tag' });

		const afterOtherName = await readItems(SHELF, query);

		expect(afterOtherName.headers[cacheStatusHeader]).toBe('HIT');

		expect(afterOtherName.body.data).toEqual([
			{ id: shelfId, labels: [{ [`${LABEL}_id`]: { name: 'red tag' } }] },
		]);

		await updateItem(LABEL, redLabelId, { name: 'scarlet tag' });

		const afterName = await readItems(SHELF, query);

		expect(afterName.headers[cacheStatusHeader]).toBe('MISS');

		expect(afterName.body.data).toEqual([
			{ id: shelfId, labels: [{ [`${LABEL}_id`]: { name: 'scarlet tag' } }] },
		]);
	});

	it(oneLine`
		purges a read pinned on its parent's id alone on a write to that parent,
		not to another
	`, async () => {
		const query = {
			'fields': 'id,project.name',
			'filter[id][_eq]': String(taskId),
		};

		expect((await readItems(TASK, query)).headers[cacheStatusHeader])
			.toBe('MISS');

		expect((await readItems(TASK, query)).headers[cacheStatusHeader])
			.toBe('HIT');

		await updateItem(PROJECT, geminiId, { name: 'gemini two' });

		const afterOther = await readItems(TASK, query);

		expect(afterOther.headers[cacheStatusHeader]).toBe('HIT');

		expect(afterOther.body.data).toEqual([
			{ id: taskId, project: { name: 'apollo' } },
		]);

		await updateItem(PROJECT, apolloId, { name: 'apollo two' });

		const afterParent = await readItems(TASK, query);

		expect(afterParent.headers[cacheStatusHeader]).toBe('MISS');

		expect(afterParent.body.data).toEqual([
			{ id: taskId, project: { name: 'apollo two' } },
		]);
	});
});
