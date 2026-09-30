import config, { paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { once } from 'events';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import { afterAll, describe, expect } from 'vitest';

const feature = loadFeature(
	'./tests/db/routes/items/cache-fill-pause-max-value.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-fill-pause-max-value-${vendor}`;
	const buildKey = `${namespace}:scoped-cache-index-build`;
	const fillPauseKey = `${namespace}:scoped-cache-fill-pause`;
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = namespace;
	env[vendor]['CACHE_SCOPED_INDEX_REAP_SCHEDULE'] = '0 0 1 1 *';
	env[vendor]['CACHE_AUTO_FLUSH_ON_DEPLOY'] = 'false';
	// The line a failed record logs is a warn one.
	env[vendor]['LOG_LEVEL'] = 'info';
	env[vendor]['LOG_STYLE'] = 'raw';

	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	let instance: ChildProcess | null = null;
	let instanceLog: string[] = [];

	async function stopInstance() {
		if (instance === null) {
			return;
		}

		instance.kill();
		await once(instance, 'exit');
		instance = null;
	}

	async function restartInstance() {
		await stopInstance();
		env[vendor].PORT = String(await getPort());
		instanceLog = [];

		const spawned = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		spawned.stdout?.on('data', (chunk) => instanceLog.push(String(chunk)));
		spawned.stderr?.on('data', (chunk) => instanceLog.push(String(chunk)));
		instance = spawned;

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}

	async function clearNamespace() {
		for (const key of await redisClient.keys(`${namespace}:*`)) {
			await redisClient.del(key);
		}
	}

	afterAll(async () => {
		await stopInstance();
		await clearNamespace();
		await redisClient.quit();
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'a ceiling that parses to a fraction of a millisecond opens the pause',
			({ given, when, then, and }) => {
				given(
					/^the instance runs on ([\w-]+) with no fill pause$/,
					async (buildId: string) => {
						env[vendor]['CACHE_BUILD_ID'] = buildId;
						env[vendor]['CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX'] = '0';
						await restartInstance();
					},
				);

				when(
					/^the instance restarts on ([\w-]+) pausing fills for at most ([\w.]+)$/,
					async (buildId: string, fillPause: string) => {
						env[vendor]['CACHE_BUILD_ID'] = buildId;
						env[vendor]['CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX'] = fillPause;
						await restartInstance();
					},
				);

				// The build is recorded on the Redis client's `ready`, which the boot
				// does not wait on.
				then(
					/^the fill pause runs on ([\w-]+) for at most (\d+) ms$/,
					async (buildId: string, fillPauseMs: string) => {
						await expect.poll(() => redisClient.get(fillPauseKey), {
							timeout: 10_000,
						}).toBe(buildId);

						const pauseLeftMs = await redisClient.pttl(fillPauseKey);

						expect(pauseLeftMs).toBeLessThanOrEqual(Number(fillPauseMs));
						expect(pauseLeftMs).toBeGreaterThan(200_000);
					},
				);

				and(/^the recorded build is ([\w-]+)$/, async (buildId: string) => {
					expect(await redisClient.get(buildKey)).toBe(buildId);
				});

				and('the instance logged no failure recording the build', () => {
					expect(instanceLog.join('')).not.toContain(
						'recording the build for the index failed',
					);
				});
			},
			60_000,
		);

		scenario(
			'a node that purges the whole cache records no build and opens no pause',
			({ given, when, then, and }) => {
				given('the instance has stopped', stopInstance);

				and('the namespace holds no keys', clearNamespace);

				// Settled once the build a scoped node records would have landed: it is
				// recorded on the Redis client's `ready`, which the boot does not wait
				// on.
				when(
					/^a full-purge instance starts on ([\w-]+) pausing for at most ([\w.]+)$/,
					async (buildId: string, fillPause: string) => {
						env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'full';
						env[vendor]['CACHE_BUILD_ID'] = buildId;
						env[vendor]['CACHE_SCOPED_DEPLOY_FILL_PAUSE_MAX'] = fillPause;
						await restartInstance();
						await new Promise((resolve) => setTimeout(resolve, 3_000));
					},
				);

				then('no build is recorded', async () => {
					expect(await redisClient.get(buildKey)).toBeNull();
				});

				and('no fill pause runs', async () => {
					expect(await redisClient.exists(fillPauseKey)).toBe(0);
				});
			},
			60_000,
		);
	});
});
