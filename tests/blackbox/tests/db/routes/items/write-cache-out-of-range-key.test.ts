import config, { paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { awaitDirectusConnection } from '@utils/await-connection';
import { stopSpawnedInstance } from '@utils/stop-spawned-instance';
import { type ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { cloneDeep } from 'lodash-es';
import { afterAll, beforeAll, describe } from 'vitest';
import { cacheStatusHeader, defineWriteCacheSteps } from './write-cache-steps';

const feature = loadFeature(
	'./tests/db/routes/items/write-cache-out-of-range-key.feature',
);

// A key past the integer range fails only where Postgres binds it as integer.
describe.each(vendors)('%s', (vendor) => {
	describe.runIf(vendor === 'postgres')('out-of-range key', () => {
		const cacheEnv = cloneDeep(config.envs);
		cacheEnv[vendor]['CACHE_ENABLED'] = 'true';
		cacheEnv[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		cacheEnv[vendor]['CACHE_AUTO_PURGE'] = 'true';
		cacheEnv[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		cacheEnv[vendor]['CACHE_STORE'] = 'redis';
		cacheEnv[vendor]['REDIS_HOST'] = 'localhost';
		cacheEnv[vendor]['REDIS_PORT'] = '6108';

		// A re-run inside the TTL would otherwise read the last run's entries.
		cacheEnv[vendor]['CACHE_NAMESPACE']
			= `directus-write-cache-out-of-range-key-${vendor}-${randomUUID()}`;

		let cacheInstance: ChildProcess;

		beforeAll(async () => {
			cacheEnv[vendor].PORT = String(await freePortOfWorker());

			cacheInstance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: cacheEnv[vendor],
			});

			await awaitDirectusConnection(Number(cacheEnv[vendor].PORT));
		}, 60_000);

		afterAll(() => {
			return stopSpawnedInstance(cacheInstance);
		}, 60_000);

		defineFeature(feature, (scenario) => {
			for (const { title } of feature.scenarios) {
				scenario(title, (steps) => {
					defineWriteCacheSteps(steps, vendor, cacheEnv);
				}, 60_000);
			}
		});
	});
});
