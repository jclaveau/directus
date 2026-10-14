import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
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

const REFUSED = 'test_takeover_refused';
const UPSERT_PARENT = 'test_takeover_upsert_parent';
const UPSERT_CHILD = 'test_takeover_upsert_child';
const INERT = 'test_takeover_inert';
const INERT_BIG = 'test_takeover_inert_big';
const MOVED = 'test_takeover_moved';
const PARTLY_DECLARED = 'test_takeover_partly_declared';
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
	let refusedRowId: number;
	let upsertParentId: number;
	let sentChildId: number;
	let inertRowId: number;
	let bigInertRowId: string;
	let movedRowId: number;
	let partlyDeclaredRowIds: number[];

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{
					collection: REFUSED,
					fields: [{ field: 'body', type: 'string', meta: {} }],
				},
				{
					collection: UPSERT_PARENT,
					fields: [{ field: 'title', type: 'string', meta: {} }],
				},
				{
					collection: UPSERT_CHILD,
					meta: { scoped_cache_fields: ['slot'] },
					fields: [
						{ field: 'slot', type: 'string', meta: {} },
						{ field: 'marker', type: 'string', meta: {} },
						{ field: 'body', type: 'string', meta: {} },
					],
				},
				{
					collection: INERT,
					fields: [{ field: 'body', type: 'string', meta: {} }],
				},
				{
					collection: INERT_BIG,
					primaryKeyType: 'bigInteger',
					fields: [{ field: 'body', type: 'string', meta: {} }],
				},
				{
					collection: MOVED,
					meta: { scoped_cache_fields: ['slot'] },
					fields: [
						{ field: 'slot', type: 'string', meta: {} },
						{ field: 'body', type: 'string', meta: {} },
					],
				},
				{
					collection: PARTLY_DECLARED,
					meta: { scoped_cache_fields: ['slot'] },
					fields: [
						{ field: 'slot', type: 'string', meta: {} },
						{ field: 'body', type: 'string', meta: {} },
					],
				},
			],
		});

		await CreateFieldO2M(vendor, {
			collection: UPSERT_PARENT,
			field: 'children',
			otherCollection: UPSERT_CHILD,
			otherField: 'parent',
		});

		const refusedRow = await CreateItem(vendor, {
			collection: REFUSED,
			item: { body: 'original' },
		});

		refusedRowId = refusedRow.id;

		const upsertParent = await CreateItem(vendor, {
			collection: UPSERT_PARENT,
			item: { title: 'parent' },
		});

		upsertParentId = upsertParent.id;

		const [sentChild] = await CreateItem(vendor, {
			collection: UPSERT_CHILD,
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
			collection: INERT,
			item: { body: 'original' },
		});

		inertRowId = inertRow.id;

		const bigInertRow = await CreateItem(vendor, {
			collection: INERT_BIG,
			item: { body: 'original' },
		});

		bigInertRowId = String(bigInertRow.id);

		const [movedRow] = await CreateItem(vendor, {
			collection: MOVED,
			item: [
				{ slot: 'a', body: 'original' },
				{ slot: 'c', body: 'bystander' },
			],
		});

		movedRowId = movedRow.id;

		const partlyDeclaredRows = await CreateItem(vendor, {
			collection: PARTLY_DECLARED,
			item: [
				{ slot: 'a', body: 'original' },
				{ slot: 'b', body: 'original' },
			],
		});

		partlyDeclaredRowIds = partlyDeclaredRows.map((row: { id: number }) => {
			return row.id;
		});

		cacheEnv[vendor].PORT = String(await getPort());

		cacheInstance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: cacheEnv[vendor],
		});

		await awaitDirectusConnection(Number(cacheEnv[vendor].PORT));
	}, 60_000);

	afterAll(async () => {
		cacheInstance.kill();

		await DeleteCollection(vendor, { collection: REFUSED });
		await DeleteCollection(vendor, { collection: UPSERT_CHILD });
		await DeleteCollection(vendor, { collection: UPSERT_PARENT });
		await DeleteCollection(vendor, { collection: INERT });
		await DeleteCollection(vendor, { collection: INERT_BIG });
		await DeleteCollection(vendor, { collection: MOVED });
		await DeleteCollection(vendor, { collection: PARTLY_DECLARED });
	});

	defineFeature(takeoverFeature, (scenario) => {
		scenario(
			'a refused answer still purges the row its hook took over',
			({ given, when, then, and }) => {
				let refusedUpdate: request.Response;

				function readRefused() {
					return request(getUrl(vendor, cacheEnv))
						.get(`/items/${REFUSED}`)
						.query({ fields: 'body' })
						.set('Authorization', adminAuth);
				}

				given(
					`the read of ${REFUSED} is cached:`,
					async (table: Record<string, string>[]) => {
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
						refusedUpdate = await request(getUrl(vendor, cacheEnv))
							.patch(`/items/${REFUSED}/${refusedRowId}`)
							.send({ body })
							.set('Authorization', adminAuth);
					},
				);

				then(
					'the update is refused with the message:',
					(docString: string) => {
						expect(refusedUpdate.statusCode).toBe(400);

						expect(refusedUpdate.body.errors[0].message).toEqual(
							docString
								.split('\n')
								.join(' ')
								.replace(/\{([\w-]+)\}/g, () => String(refusedRowId)),
						);
					},
				);

				and(
					`the read of ${REFUSED} answers:`,
					async (table: Record<string, string>[]) => {
						const { cache, response } = table[0]!;
						const answeredRead = await readRefused();

						expect(answeredRead.headers[cacheStatusHeader]).toBe(cache);
						expect(answeredRead.body.data).toEqual(loadYaml(response!));
					},
				);
			},
			60_000,
		);

		scenario(
			'an upsert whose hook takes over a row it never sent purges that row',
			({ given, when, then }) => {
				function readSlot(slot: string) {
					return request(getUrl(vendor, cacheEnv))
						.get(`/items/${UPSERT_CHILD}`)
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
							.patch(`/items/${UPSERT_PARENT}/${upsertParentId}`)
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
						.get(`/items/${INERT}`)
						.query({ fields: 'body' })
						.set('Authorization', adminAuth);
				}

				given(
					`the read of ${INERT} is cached:`,
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
							.patch(`/items/${INERT}/${inertRowId}`)
							.send({ body })
							.set('Authorization', adminAuth);

						expect(sentUpdate.statusCode).toBe(200);
					},
				);

				then(
					`the read of ${INERT} answers:`,
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
						.get(`/items/${INERT_BIG}`)
						.query({ fields: 'body' })
						.set('Authorization', adminAuth);
				}

				given(
					`the read of ${INERT_BIG} is cached:`,
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
							.patch(`/items/${INERT_BIG}/${bigInertRowId}`)
							.send({ body })
							.set('Authorization', adminAuth);

						expect(sentUpdate.statusCode).toBe(200);
					},
				);

				then(
					`the read of ${INERT_BIG} answers:`,
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
						.get(`/items/${MOVED}`)
						.query({ fields: 'body', 'filter[slot][_eq]': slot })
						.set('Authorization', adminAuth);
				}

				given(
					`the reads of ${MOVED} are cached:`,
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
							.patch(`/items/${MOVED}/${movedRowId}`)
							.send({ body })
							.set('Authorization', adminAuth);

						expect(sentUpdate.statusCode).toBe(200);
					},
				);

				then(
					`the reads of ${MOVED} answer:`,
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
						.get(`/items/${PARTLY_DECLARED}`)
						.query({ fields: 'body', 'filter[slot][_eq]': slot })
						.set('Authorization', adminAuth);
				}

				given(
					`the reads of ${PARTLY_DECLARED} are cached:`,
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
							.patch(`/items/${PARTLY_DECLARED}`)
							.send({ keys: partlyDeclaredRowIds, data: { body } })
							.set('Authorization', adminAuth);

						expect(sentUpdate.statusCode).toBe(200);
					},
				);

				then(
					`the reads of ${PARTLY_DECLARED} answer:`,
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
	});
});
