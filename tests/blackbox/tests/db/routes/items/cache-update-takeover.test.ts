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
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const REFUSED = 'test_takeover_refused';
const UPSERT_PARENT = 'test_takeover_upsert_parent';
const UPSERT_CHILD = 'test_takeover_upsert_child';
const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-update-takeover.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = `directus-update-takeover-${vendor}`;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;
	let refusedRowId: number;
	let upsertParentId: number;
	let sentChildId: number;

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

		env[vendor].PORT = String(await getPort());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		await DeleteCollection(vendor, { collection: REFUSED });
		await DeleteCollection(vendor, { collection: UPSERT_CHILD });
		await DeleteCollection(vendor, { collection: UPSERT_PARENT });
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'a refused answer still purges the row its hook took over',
			({ given, when, then, and }) => {
				let refusal: request.Response;

				function readRefused() {
					return request(getUrl(vendor, env))
						.get(`/items/${REFUSED}`)
						.query({ fields: 'body' })
						.set('Authorization', auth);
				}

				given(
					`the read of ${REFUSED} is cached:`,
					async (table: Record<string, string>[]) => {
						expect((await readRefused()).headers[cacheStatusHeader])
							.toBe('MISS');

						const cached = await readRefused();

						expect(cached.headers[cacheStatusHeader]).toBe('HIT');
						expect(cached.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);

				when(
					/^its row is sent the body "(.*)"$/,
					async (body: string) => {
						refusal = await request(getUrl(vendor, env))
							.patch(`/items/${REFUSED}/${refusedRowId}`)
							.send({ body })
							.set('Authorization', auth);
					},
				);

				then(
					'the update is refused with the message:',
					(docString: string) => {
						expect(refusal.statusCode).toBe(400);

						expect(refusal.body.errors[0].message).toEqual(
							docString
								.split('\n')
								.join(' ')
								.replace('{row}', String(refusedRowId)),
						);
					},
				);

				and(
					`the read of ${REFUSED} answers:`,
					async (table: Record<string, string>[]) => {
						const { cache, response } = table[0]!;
						const answered = await readRefused();

						expect(answered.headers[cacheStatusHeader]).toBe(cache);
						expect(answered.body.data).toEqual(loadYaml(response!));
					},
				);
			},
			60_000,
		);

		scenario(
			'an upsert whose hook takes over a row it never sent purges that row',
			({ given, when, then }) => {
				function readSlot(slot: string) {
					return request(getUrl(vendor, env))
						.get(`/items/${UPSERT_CHILD}`)
						.query({ fields: 'body', 'filter[slot][_eq]': slot })
						.set('Authorization', auth);
				}

				given(
					/^the read of \w+ in slot "(.*)" is cached:$/,
					async (slot: string, table: Record<string, string>[]) => {
						expect((await readSlot(slot)).headers[cacheStatusHeader])
							.toBe('MISS');

						const cached = await readSlot(slot);

						expect(cached.headers[cacheStatusHeader]).toBe('HIT');
						expect(cached.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);

				when(
					/^the parent sends its child the body "(.*)"$/,
					async (body: string) => {
						const sent = await request(getUrl(vendor, env))
							.patch(`/items/${UPSERT_PARENT}/${upsertParentId}`)
							.send({ children: [{ id: sentChildId, body }] })
							.set('Authorization', auth);

						expect(sent.statusCode).toBe(200);
					},
				);

				then(
					/^the read of \w+ in slot "(.*)" answers:$/,
					async (slot: string, table: Record<string, string>[]) => {
						const { cache, response } = table[0]!;
						const answered = await readSlot(slot);

						expect(answered.headers[cacheStatusHeader]).toBe(cache);
						expect(answered.body.data).toEqual(loadYaml(response!));
					},
				);
			},
			60_000,
		);
	});
});
