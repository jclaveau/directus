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

const SLOT = 'relation_change_slot';
const ZONE = 'relation_change_zone';

const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature(
	'./tests/db/routes/items/cache-relation-change.feature',
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
	env[vendor]['CACHE_NAMESPACE'] = `directus-relation-change-${vendor}`;

	let instance: ChildProcess;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		// The scoped instance reads `scoped_cache_fields` off the schema it boots on,
		// so the collections precede the spawn.
		await CreateCollections(vendor, {
			collections: [
				{
					collection: SLOT,
					meta: { scoped_cache_fields: ['zone'] },
					fields: [
						{ field: 'zone', type: 'integer', meta: {} },
						{ field: 'note', type: 'string', meta: {} },
					],
				},
				{
					collection: ZONE,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [{ field: 'owner', type: 'string', meta: {} }],
				},
			],
		});

		const port = await getPort();
		env[vendor].PORT = String(port);

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(port);
	}, 60_000);

	// The slots hold the relation, so they go before the zones it points at.
	afterAll(async () => {
		instance.kill();

		await DeleteCollection(vendor, { collection: SLOT });
		await DeleteCollection(vendor, { collection: ZONE });
	});

	function readSlots(query: string) {
		return request(getUrl(vendor, env))
			.get(`/items/${SLOT}`)
			.query(loadYaml(query) as Record<string, string[]>)
			.set('Authorization', auth);
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'creating a relation flushes the reads cached before it',
			({ given, and, when, then }) => {
				given('the slots:', async (table: Record<string, string>[]) => {
					const created = await request(getUrl(vendor, env))
						.post(`/items/${SLOT}`)
						.send(table)
						.set('Authorization', auth);

					expect(created.statusCode).toBe(200);
				});

				and(
					'this read of the slots is cached:',
					async (table: Record<string, string>[]) => {
						const { query, response } = table[0]!;

						// The MISS then HIT proves there is an entry to flush at all.
						expect((await readSlots(query!)).headers[cacheStatusHeader])
							.toBe('MISS');

						const cached = await readSlots(query!);

						expect(cached.headers[cacheStatusHeader]).toBe('HIT');
						expect(cached.body.data).toEqual(loadYaml(response!));
					},
				);

				when('the slots\' zone becomes a relation to the zones', async () => {
					const created = await request(getUrl(vendor, env))
						.post('/relations')
						.send({
							collection: SLOT,
							field: 'zone',
							related_collection: ZONE,
							schema: { on_delete: 'SET NULL' },
						})
						.set('Authorization', auth);

					expect(created.statusCode).toBe(200);
				});

				then(
					/^the read is filled again, .+:$/,
					async (table: Record<string, string>[]) => {
						const { query, response } = table[0]!;
						const refilled = await readSlots(query!);

						expect(refilled.headers[cacheStatusHeader]).toBe('MISS');
						expect(refilled.body.data).toEqual(loadYaml(response!));
					},
				);
			},
			60_000,
		);
	});
});
