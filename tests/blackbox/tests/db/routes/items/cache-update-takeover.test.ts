import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollections, CreateItem, DeleteCollection } from '@common/functions';
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

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{
					collection: REFUSED,
					fields: [{ field: 'body', type: 'string', meta: {} }],
				},
			],
		});

		const refusedRow = await CreateItem(vendor, {
			collection: REFUSED,
			item: { body: 'original' },
		});

		refusedRowId = refusedRow.id;

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
	});
});
