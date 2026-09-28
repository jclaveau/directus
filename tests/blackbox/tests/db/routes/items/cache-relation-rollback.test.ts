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

const CHILD = 'relation_rollback_child';
const PARENT = 'relation_rollback_parent';
const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-relation-rollback.feature',
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
	env[vendor]['CACHE_NAMESPACE'] = `directus-relation-rollback-${vendor}`;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{ collection: PARENT, fields: [] },
				{
					collection: CHILD,
					fields: [{ field: 'parent', type: 'integer', meta: {} }],
				},
			],
		});

		env[vendor].PORT = String(await getPort());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		await DeleteCollection(vendor, { collection: CHILD });
		await DeleteCollection(vendor, { collection: PARENT });
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'a relation the database refuses does not flush the cached reads',
			({ given, and, when, then }) => {
				function readChildren() {
					return request(getUrl(vendor, env))
						.get(`/items/${CHILD}`)
						.query({ fields: 'parent' })
						.set('Authorization', auth);
				}

				given(
					`this row of ${CHILD}:`,
					async (table: Record<string, string>[]) => {
						const created = await request(getUrl(vendor, env))
							.post(`/items/${CHILD}`)
							.send({ parent: Number(table[0]!.parent) })
							.set('Authorization', auth);

						expect(created.statusCode).toBe(200);
					},
				);

				and(
					'this read is cached:',
					async (table: Record<string, string>[]) => {
						expect((await readChildren()).headers[cacheStatusHeader])
							.toBe('MISS');

						const cached = await readChildren();

						expect(cached.headers[cacheStatusHeader]).toBe('HIT');
						expect(cached.body.data).toEqual(loadYaml(table[0]!.response!));
					},
				);

				when(
					`a relation from parent to ${PARENT} is refused`,
					async () => {
						const refused = await request(getUrl(vendor, env))
							.post('/relations')
							.send({
								collection: CHILD,
								field: 'parent',
								related_collection: PARENT,
							})
							.set('Authorization', auth);

						expect(refused.statusCode).not.toBe(200);
					},
				);

				then(
					'this read answers:',
					async (table: Record<string, string>[]) => {
						const { cache, response } = table[0]!;
						const answered = await readChildren();

						expect(answered.headers[cacheStatusHeader]).toBe(cache);
						expect(answered.body.data).toEqual(loadYaml(response!));
					},
				);
			},
			60_000,
		);
	});
});
