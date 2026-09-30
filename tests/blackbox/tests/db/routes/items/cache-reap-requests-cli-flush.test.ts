import config, { paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { once } from 'events';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const feature = loadFeature(
	'./tests/db/routes/items/cache-reap-requests-cli-flush.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-reap-requests-cli-${vendor}`;
	const markerKey = `${namespace}:scoped-cache-index:collection-index-keys-complete`;
	const generationKey = `${namespace}:scoped-cache-index-generation`;
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = namespace;
	env[vendor]['CACHE_TTL'] = '1h';
	env[vendor]['CACHE_SCOPED_INDEX_REAP_SCHEDULE'] = '0 0 1 1 *';
	env[vendor]['CACHE_AUTO_FLUSH_ON_DEPLOY'] = 'false';
	env[vendor]['CACHE_BUILD_ID'] = 'reap-requests-cli-build';

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	let instance: ChildProcess;

	beforeAll(async () => {
		env[vendor].PORT = String(await getPort());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}, 60_000);

	afterAll(async () => {
		instance.kill();
		await once(instance, 'exit');

		for (const key of await redisClient.keys(`${namespace}:*`)) {
			await redisClient.del(key);
		}

		await redisClient.quit();
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'a running node reaps after "directus cache flush" ran in a process of its '
			+ 'own',
			({ given, when, then, and }) => {
				let flushedGeneration: string | null = null;
				let flushExitCode: number | null = null;

				// By the pass the instance's boot asked for.
				given('the index-key sets are marked complete', async () => {
					await expect.poll(async () => {
						const [marker, generation] = await redisClient.mget(
							markerKey,
							generationKey,
						);

						return marker !== null && marker === generation;
					}, { timeout: 15_000 }).toBe(true);
				});

				when('"directus cache flush" runs in a process of its own', async () => {
					flushedGeneration = await redisClient.get(generationKey);

					const flush = spawn('node', [paths.cli, 'cache', 'flush'], {
						cwd: paths.cwd,
						env: env[vendor],
					});

					[flushExitCode] = await once(flush, 'exit');
				});

				then('the command exits 0', () => {
					expect(flushExitCode).toBe(0);
				});

				// Written only by a pass the running node ran: the command's own
				// request died with it, and the schedule is a year out.
				and(
					'the index-key sets are marked complete at a generation after the '
					+ 'flush',
					async () => {
						await expect.poll(async () => {
							const [marker, generation] = await redisClient.mget(
								markerKey,
								generationKey,
							);

							return marker === generation && generation !== flushedGeneration;
						}, { timeout: 15_000 }).toBe(true);
					},
				);
			},
			60_000,
		);
	});
});
