import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	messageOfDocString,
} from '@common/cucumber';
import {
	CreateCollections,
	CreateFieldO2M,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { oneLine } from '@directus/utils';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const refusedCollection = 'test_takeover_refused';
const pooledCollection = 'test_takeover_refused_pooled';
const upsertParentCollection = 'test_takeover_upsert_parent';
const upsertChildCollection = 'test_takeover_upsert_child';
const inertCollection = 'test_takeover_inert';
const bigInertCollection = 'test_takeover_inert_big';
const movedCollection = 'test_takeover_moved';
const partlyDeclaredCollection = 'test_takeover_partly_declared';
const hookThrewCollection = 'test_takeover_hook_threw';
const createFailedCollection = 'test_takeover_create_failed';
const cacheStatusHeader = 'x-cache-status';

const takeoverFeature = loadFeature(
	'./tests/db/routes/items/cache-update-takeover.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const cacheEnv = cloneDeep(config.envs);
	cacheEnv[vendor]['CACHE_ENABLED'] = 'true';
	cacheEnv[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	cacheEnv[vendor]['CACHE_AUTO_PURGE'] = 'true';
	cacheEnv[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	cacheEnv[vendor]['CACHE_STORE'] = 'redis';
	cacheEnv[vendor]['REDIS_HOST'] = 'localhost';
	cacheEnv[vendor]['REDIS_PORT'] = '6108';
	cacheEnv[vendor]['CACHE_NAMESPACE'] = `directus-update-takeover-${vendor}`;

	const adminAuth = `Bearer ${USER.ADMIN.TOKEN}`;
	let cacheInstance: ChildProcess;
	const refusedRowIds: Record<string, number> = {};
	let upsertParentId: number;
	let sentChildId: number;
	let inertRowId: number;
	let bigInertRowId: string;
	let movedRowId: number;
	let partlyDeclaredRowIds: number[];
	let hookThrewRowId: number;
	let duplicateRowId: number;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{
					collection: refusedCollection,
					fields: [{ field: 'body', type: 'string', meta: {} }],
				},
				{
					collection: pooledCollection,
					fields: [{ field: 'body', type: 'string', meta: {} }],
				},
				{
					collection: upsertParentCollection,
					fields: [{ field: 'title', type: 'string', meta: {} }],
				},
				{
					collection: upsertChildCollection,
					meta: { scoped_cache_fields: ['slot'] },
					fields: [
						{ field: 'slot', type: 'string', meta: {} },
						{ field: 'marker', type: 'string', meta: {} },
						{ field: 'body', type: 'string', meta: {} },
					],
				},
				{
					collection: inertCollection,
					fields: [{ field: 'body', type: 'string', meta: {} }],
				},
				{
					collection: bigInertCollection,
					primaryKeyType: 'bigInteger',
					fields: [{ field: 'body', type: 'string', meta: {} }],
				},
				{
					collection: movedCollection,
					meta: { scoped_cache_fields: ['slot'] },
					fields: [
						{ field: 'slot', type: 'string', meta: {} },
						{ field: 'body', type: 'string', meta: {} },
					],
				},
				{
					collection: partlyDeclaredCollection,
					meta: { scoped_cache_fields: ['slot'] },
					fields: [
						{ field: 'slot', type: 'string', meta: {} },
						{ field: 'body', type: 'string', meta: {} },
					],
				},
				{
					collection: hookThrewCollection,
					fields: [{ field: 'body', type: 'string', meta: {} }],
				},
				{
					collection: createFailedCollection,
					fields: [
						{ field: 'marker', type: 'string', meta: {} },
						{ field: 'body', type: 'string', meta: {} },
					],
				},
			],
		});

		await CreateFieldO2M(vendor, {
			collection: upsertParentCollection,
			field: 'children',
			otherCollection: upsertChildCollection,
			otherField: 'parent',
		});

		for (const collection of [refusedCollection, pooledCollection]) {
			const refusedRow = await CreateItem(vendor, {
				collection,
				item: { body: 'original' },
			});

			refusedRowIds[collection] = refusedRow.id;
		}

		const upsertParent = await CreateItem(vendor, {
			collection: upsertParentCollection,
			item: { title: 'parent' },
		});

		upsertParentId = upsertParent.id;

		const [sentChild] = await CreateItem(vendor, {
			collection: upsertChildCollection,
			item: [
				{
					slot: 'a',
					marker: 'sent',
					body: 'original',
					parent: upsertParentId,
				},
				{ slot: 'b', marker: 'sibling', body: 'original' },
			],
		});

		sentChildId = sentChild.id;

		const inertRow = await CreateItem(vendor, {
			collection: inertCollection,
			item: { body: 'original' },
		});

		inertRowId = inertRow.id;

		const bigInertRow = await CreateItem(vendor, {
			collection: bigInertCollection,
			item: { body: 'original' },
		});

		bigInertRowId = String(bigInertRow.id);

		const [movedRow] = await CreateItem(vendor, {
			collection: movedCollection,
			item: [
				{ slot: 'a', body: 'original' },
				{ slot: 'c', body: 'bystander' },
			],
		});

		movedRowId = movedRow.id;

		const [declaredRow, undeclaredRow] = await CreateItem(vendor, {
			collection: partlyDeclaredCollection,
			item: [
				{ slot: 'a', body: 'original' },
				{ slot: 'b', body: 'original' },
				{ slot: 'e', body: 'bystander' },
			],
		});

		partlyDeclaredRowIds = [declaredRow.id, undeclaredRow.id];

		const hookThrewRow = await CreateItem(vendor, {
			collection: hookThrewCollection,
			item: { body: 'original' },
		});

		hookThrewRowId = hookThrewRow.id;

		const [, duplicateRow] = await CreateItem(vendor, {
			collection: createFailedCollection,
			item: [
				{ marker: 'taken', body: 'original' },
				{ marker: 'duplicate', body: 'original' },
			],
		});

		duplicateRowId = duplicateRow.id;

		cacheEnv[vendor].PORT = String(await getPort());

		cacheInstance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: cacheEnv[vendor],
		});

		await awaitDirectusConnection(Number(cacheEnv[vendor].PORT));
	}, 60_000);

	afterAll(async () => {
		cacheInstance.kill();

		await DeleteCollection(vendor, { collection: refusedCollection });
		await DeleteCollection(vendor, { collection: pooledCollection });
		await DeleteCollection(vendor, { collection: upsertChildCollection });
		await DeleteCollection(vendor, { collection: upsertParentCollection });
		await DeleteCollection(vendor, { collection: inertCollection });
		await DeleteCollection(vendor, { collection: bigInertCollection });
		await DeleteCollection(vendor, { collection: movedCollection });
		await DeleteCollection(vendor, { collection: partlyDeclaredCollection });
		await DeleteCollection(vendor, { collection: hookThrewCollection });
		await DeleteCollection(vendor, { collection: createFailedCollection });
	});

	defineFeature(takeoverFeature, (scenario) => {
		for (const scenarioTitle of [
			'a refused answer still purges the row its hook took over',
			oneLine`
				a refused answer purges the row its hook committed through the pool
			`,
		]) {
			scenario(scenarioTitle, ({ given, when, then, and }) => {
				let refusedCollectionName = '';
				let refusedUpdate: request.Response;

				function readRefused() {
					return request(getUrl(vendor, cacheEnv))
						.get(`/items/${refusedCollectionName}`)
						.query({ fields: 'body' })
						.set('Authorization', adminAuth);
				}

				given(
					/^the read of (\w+) is cached:$/,
					async (collection: string, table: Record<string, string>[]) => {
						refusedCollectionName = collection;

						expect((await readRefused()).headers[cacheStatusHeader])
							.toBe('MISS');

						const cachedRead = await readRefused();

						expect(cachedRead.headers[cacheStatusHeader]).toBe('HIT');
						expect(cachedRead.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);

				when(
					/^its row is sent the body "(.*)"$/,
					async (body: string) => {
						const rowId = refusedRowIds[refusedCollectionName];

						refusedUpdate = await request(getUrl(vendor, cacheEnv))
							.patch(`/items/${refusedCollectionName}/${rowId}`)
							.send({ body })
							.set('Authorization', adminAuth);
					},
				);

				then(
					'the update is refused with the message:',
					(docString: string) => {
						expect(refusedUpdate.statusCode).toBe(400);

						expect(refusedUpdate.body.errors[0].message).toEqual(
							messageOfDocString(docString, () => {
								return refusedRowIds[refusedCollectionName]!;
							}),
						);
					},
				);

				and(
					/^the read of \w+ answers:$/,
					async (table: Record<string, string>[]) => {
						const { cache, response } = table[0]!;
						const answeredRead = await readRefused();

						expect(answeredRead.headers[cacheStatusHeader]).toBe(cache);
						expect(answeredRead.body.data).toEqual(loadYaml(response!));
					},
				);
			}, 60_000);
		}

		scenario(
			'an upsert whose hook takes over a row it never sent purges that row',
			({ given, when, then }) => {
				function readSlot(slot: string) {
					return request(getUrl(vendor, cacheEnv))
						.get(`/items/${upsertChildCollection}`)
						.query({ fields: 'body', 'filter[slot][_eq]': slot })
						.set('Authorization', adminAuth);
				}

				given(
					/^the read of \w+ in slot "(.*)" is cached:$/,
					async (slot: string, table: Record<string, string>[]) => {
						expect((await readSlot(slot)).headers[cacheStatusHeader])
							.toBe('MISS');

						const cachedRead = await readSlot(slot);

						expect(cachedRead.headers[cacheStatusHeader]).toBe('HIT');
						expect(cachedRead.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);

				when(
					/^the parent sends its child the body "(.*)"$/,
					async (body: string) => {
						const sentUpdate = await request(getUrl(vendor, cacheEnv))
							.patch(`/items/${upsertParentCollection}/${upsertParentId}`)
							.send({ children: [{ id: sentChildId, body }] })
							.set('Authorization', adminAuth);

						expect(sentUpdate.statusCode).toBe(200);
					},
				);

				then(
					/^the read of \w+ in slot "(.*)" answers:$/,
					async (slot: string, table: Record<string, string>[]) => {
						const { cache, response } = table[0]!;
						const answeredRead = await readSlot(slot);

						expect(answeredRead.headers[cacheStatusHeader]).toBe(cache);
						expect(answeredRead.body.data).toEqual(loadYaml(response!));
					},
				);
			},
			60_000,
		);

		scenario(
			'a takeover declared inert under another spelling of its key purges nothing',
			({ given, when, then }) => {
				function readInert() {
					return request(getUrl(vendor, cacheEnv))
						.get(`/items/${inertCollection}`)
						.query({ fields: 'body' })
						.set('Authorization', adminAuth);
				}

				given(
					`the read of ${inertCollection} is cached:`,
					async (table: Record<string, string>[]) => {
						expect((await readInert()).headers[cacheStatusHeader])
							.toBe('MISS');

						const cachedRead = await readInert();

						expect(cachedRead.headers[cacheStatusHeader]).toBe('HIT');
						expect(cachedRead.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);

				when(
					/^its row is sent the body "(.*)"$/,
					async (body: string) => {
						const sentUpdate = await request(getUrl(vendor, cacheEnv))
							.patch(`/items/${inertCollection}/${inertRowId}`)
							.send({ body })
							.set('Authorization', adminAuth);

						expect(sentUpdate.statusCode).toBe(200);
					},
				);

				then(
					`the read of ${inertCollection} answers:`,
					async (table: Record<string, string>[]) => {
						const { cache, response } = table[0]!;
						const answeredRead = await readInert();

						expect(answeredRead.headers[cacheStatusHeader]).toBe(cache);
						expect(answeredRead.body.data).toEqual(loadYaml(response!));
					},
				);
			},
			60_000,
		);

		scenario(
			'a bigInteger takeover declared inert under a zero-led key purges nothing',
			({ given, when, then }) => {
				function readBigInert() {
					return request(getUrl(vendor, cacheEnv))
						.get(`/items/${bigInertCollection}`)
						.query({ fields: 'body' })
						.set('Authorization', adminAuth);
				}

				given(
					`the read of ${bigInertCollection} is cached:`,
					async (table: Record<string, string>[]) => {
						expect((await readBigInert()).headers[cacheStatusHeader])
							.toBe('MISS');

						const cachedRead = await readBigInert();

						expect(cachedRead.headers[cacheStatusHeader]).toBe('HIT');
						expect(cachedRead.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);

				when(
					/^its row is sent the body "(.*)"$/,
					async (body: string) => {
						const sentUpdate = await request(getUrl(vendor, cacheEnv))
							.patch(`/items/${bigInertCollection}/${bigInertRowId}`)
							.send({ body })
							.set('Authorization', adminAuth);

						expect(sentUpdate.statusCode).toBe(200);
					},
				);

				then(
					`the read of ${bigInertCollection} answers:`,
					async (table: Record<string, string>[]) => {
						const { cache, response } = table[0]!;
						const answeredRead = await readBigInert();

						expect(answeredRead.headers[cacheStatusHeader]).toBe(cache);
						expect(answeredRead.body.data).toEqual(loadYaml(response!));
					},
				);
			},
			60_000,
		);

		scenario(
			oneLine`
				an undeclared takeover of a sent row purges only the slices it moved
				between
			`,
			({ given, when, then }) => {
				function readSlot(slot: string) {
					return request(getUrl(vendor, cacheEnv))
						.get(`/items/${movedCollection}`)
						.query({ fields: 'body', 'filter[slot][_eq]': slot })
						.set('Authorization', adminAuth);
				}

				given(
					`the reads of ${movedCollection} are cached:`,
					async (table: Record<string, string>[]) => {
						for (const { slot, response } of table) {
							expect((await readSlot(slot!)).headers[cacheStatusHeader])
								.toBe('MISS');

							const cachedRead = await readSlot(slot!);

							expect(cachedRead.headers[cacheStatusHeader]).toBe('HIT');
							expect(cachedRead.body.data).toEqual(loadYaml(response!));
						}
					},
				);

				when(
					/^its row in slot "a" is sent the body "(.*)"$/,
					async (body: string) => {
						const sentUpdate = await request(getUrl(vendor, cacheEnv))
							.patch(`/items/${movedCollection}/${movedRowId}`)
							.send({ body })
							.set('Authorization', adminAuth);

						expect(sentUpdate.statusCode).toBe(200);
					},
				);

				then(
					`the reads of ${movedCollection} answer:`,
					async (table: Record<string, string>[]) => {
						for (const { slot, cache, response } of table) {
							const answeredRead = await readSlot(slot!);

							expect(answeredRead.headers[cacheStatusHeader]).toBe(cache);
							expect(answeredRead.body.data).toEqual(loadYaml(response!));
						}
					},
				);
			},
			60_000,
		);

		scenario(
			oneLine`
				a takeover declaring one of two rows still purges the slice the other
				left
			`,
			({ given, when, then }) => {
				function readSlot(slot: string) {
					return request(getUrl(vendor, cacheEnv))
						.get(`/items/${partlyDeclaredCollection}`)
						.query({ fields: 'body', 'filter[slot][_eq]': slot })
						.set('Authorization', adminAuth);
				}

				given(
					`the reads of ${partlyDeclaredCollection} are cached:`,
					async (table: Record<string, string>[]) => {
						for (const { slot, response } of table) {
							expect((await readSlot(slot!)).headers[cacheStatusHeader])
								.toBe('MISS');

							const cachedRead = await readSlot(slot!);

							expect(cachedRead.headers[cacheStatusHeader]).toBe('HIT');
							expect(cachedRead.body.data).toEqual(loadYaml(response!));
						}
					},
				);

				when(
					/^both its rows are sent the body "(.*)"$/,
					async (body: string) => {
						const sentUpdate = await request(getUrl(vendor, cacheEnv))
							.patch(`/items/${partlyDeclaredCollection}`)
							.send({ keys: partlyDeclaredRowIds, data: { body } })
							.set('Authorization', adminAuth);

						expect(sentUpdate.statusCode).toBe(200);
					},
				);

				then(
					`the reads of ${partlyDeclaredCollection} answer:`,
					async (table: Record<string, string>[]) => {
						for (const { slot, cache, response } of table) {
							const answeredRead = await readSlot(slot!);

							expect(answeredRead.headers[cacheStatusHeader]).toBe(cache);
							expect(answeredRead.body.data).toEqual(loadYaml(response!));
						}
					},
				);
			},
			60_000,
		);

		scenario(
			'a hook throwing after its own write still purges what it declared',
			({ given, when, then, and }) => {
				let failedUpdate: request.Response;

				function readHookThrew() {
					return request(getUrl(vendor, cacheEnv))
						.get(`/items/${hookThrewCollection}`)
						.query({ fields: 'body' })
						.set('Authorization', adminAuth);
				}

				given(
					`the read of ${hookThrewCollection} is cached:`,
					async (table: Record<string, string>[]) => {
						expect((await readHookThrew()).headers[cacheStatusHeader])
							.toBe('MISS');

						const cachedRead = await readHookThrew();

						expect(cachedRead.headers[cacheStatusHeader]).toBe('HIT');
						expect(cachedRead.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);

				when(
					/^its row is sent the body "(.*)"$/,
					async (body: string) => {
						failedUpdate = await request(getUrl(vendor, cacheEnv))
							.patch(`/items/${hookThrewCollection}/${hookThrewRowId}`)
							.send({ body })
							.set('Authorization', adminAuth);
					},
				);

				then(
					/^the update fails with the status (\d+) and the message:$/,
					(status: string, docString: string) => {
						expect(failedUpdate.statusCode).toBe(Number(status));

						expect(failedUpdate.body.errors[0].message)
							.toEqual(messageOfDocString(docString));
					},
				);

				and(
					`the read of ${hookThrewCollection} answers:`,
					async (table: Record<string, string>[]) => {
						const { cache, response } = table[0]!;
						const answeredRead = await readHookThrew();

						expect(answeredRead.headers[cacheStatusHeader]).toBe(cache);
						expect(answeredRead.body.data).toEqual(loadYaml(response!));
					},
				);
			},
			60_000,
		);

		scenario(
			'a failed create still purges the row its hook took over',
			({ given, when, then, and }) => {
				let failedCreate: request.Response;

				function readMarked(marker: string) {
					return request(getUrl(vendor, cacheEnv))
						.get(`/items/${createFailedCollection}`)
						.query({ fields: 'body', 'filter[marker][_eq]': marker })
						.set('Authorization', adminAuth);
				}

				given(
					/^the read of \w+ marked "(.*)" is cached:$/,
					async (marker: string, table: Record<string, string>[]) => {
						expect((await readMarked(marker)).headers[cacheStatusHeader])
							.toBe('MISS');

						const cachedRead = await readMarked(marker);

						expect(cachedRead.headers[cacheStatusHeader]).toBe('HIT');
						expect(cachedRead.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);

				when(
					/^a create sends "(.*)" beside the key of the "duplicate" row$/,
					async (body: string) => {
						failedCreate = await request(getUrl(vendor, cacheEnv))
							.post(`/items/${createFailedCollection}`)
							.send([{ body }, { id: duplicateRowId, body: 'copy' }])
							.set('Authorization', adminAuth);
					},
				);

				then(
					'the create is refused with the message:',
					(docString: string) => {
						expect(failedCreate.statusCode).toBe(400);

						expect(failedCreate.body.errors[0].message).toEqual(
							messageOfDocString(docString, () => duplicateRowId),
						);
					},
				);

				and(
					/^the read of \w+ marked "(.*)" answers:$/,
					async (marker: string, table: Record<string, string>[]) => {
						const { cache, response } = table[0]!;
						const answeredRead = await readMarked(marker);

						expect(answeredRead.headers[cacheStatusHeader]).toBe(cache);
						expect(answeredRead.body.data).toEqual(loadYaml(response!));
					},
				);
			},
			60_000,
		);
	});
});
