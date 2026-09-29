import config, { getUrl, paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

// The hooks restating the pin live in extensions/cache-hook-restated-pin.
const DEPEND_ON = 'hook_restated_depend_on';
const CACHE_SCOPE = 'hook_restated_cache_scope';

const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-hook-restated-pin-view.feature',
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
	env[vendor]['CACHE_NAMESPACE'] = `directus-hook-restated-pin-${vendor}`;

	let instance: ChildProcess;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [DEPEND_ON, CACHE_SCOPE].map((collection) => {
				return {
					collection,
					// A collection scoping on nothing never reads its rows back on a
					// write, so every update of it touches every field and no view
					// could keep an entry: the scope field is what makes it compare.
					meta: { scoped_cache_fields: ['name'] },
					fields: [
						{ field: 'name', type: 'string', meta: {} },
						{ field: 'bio', type: 'string', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
					],
				};
			}),
		});

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

		await DeleteCollection(vendor, { collection: DEPEND_ON });
		await DeleteCollection(vendor, { collection: CACHE_SCOPE });
	});

	defineFeature(feature, (scenario) => {
		for (const [title, collection] of [
			[
				'a write to the column a dependOn lookup added purges the read',
				DEPEND_ON,
			],
			[
				'a write to the column a cache.scope hook added purges the read',
				CACHE_SCOPE,
			],
		] as const) {
			scenario(title, ({ given, and, when, then }) => {
				let rowId: number;

				function readRow(fields: string) {
					return request(getUrl(vendor, env))
						.get(`/items/${collection}/${rowId}`)
						.query({ fields })
						.set('Authorization', auth);
				}

				given(
					`this row of ${collection}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${collection}`)
							.send(table[0])
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);

						rowId = created.body.data.id;
					},
				);

				and(
					'this read of the row is cached:',
					async (table: Record<string, string>[]) => {
						const { fields, response } = table[0]!;

						expect((await readRow(fields!)).headers[cacheStatusHeader])
							.toBe('MISS');

						const cached = await readRow(fields!);

						expect(cached.headers[cacheStatusHeader]).toBe('HIT');
						expect(cached.body.data).toEqual(loadYaml(response!));
					},
				);

				when(
					'the row\'s bio is written:',
					async (table: Record<string, string>[]) => {
						const updated = await request(getUrl(vendor, env))
							.patch(`/items/${collection}/${rowId}`)
							.send(table[0])
							.set('Authorization', auth);

						expect(updated.statusCode).toBe(200);
					},
				);

				then(
					'the read is filled again:',
					async (table: Record<string, string>[]) => {
						const { fields, response } = table[0]!;
						const refilled = await readRow(fields!);

						expect(refilled.headers[cacheStatusHeader]).toBe('MISS');
						expect(refilled.body.data).toEqual(loadYaml(response!));
					},
				);
			}, 60_000);
		}
	});
});
