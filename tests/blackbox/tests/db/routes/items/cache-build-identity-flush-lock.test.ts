import config, { paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { oneLine } from '@directus/utils';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import { afterAll, describe, expect } from 'vitest';

const feature = loadFeature(
	'./tests/db/routes/items/cache-build-identity-flush-lock.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const namespace = `directus-build-identity-flush-lock-${vendor}`;
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = namespace;
	env[vendor]['CACHE_AUTO_FLUSH_ON_DEPLOY'] = 'true';
	env[vendor]['CACHE_BUILD_ID'] = `build-identity-flush-lock-${Date.now()}`;

	// Namespaced twice, as Keyv names every key of a tier.
	const flushLockKey
		= `${namespace}_lock::${namespace}_lock:build-identity-flush-lock`;

	const buildIdentityKey
		= `${namespace}_lock::${namespace}_lock:build-identity`;

	const responseEntryPrefix = `${namespace}_response::${namespace}_response:`;
	const responseEntryPattern = `${namespace}_response::*`;
	const redisClient = new Redis({ host: 'localhost', port: 6108 });
	let instance: ChildProcess | undefined;

	afterAll(async () => {
		instance?.kill();

		const leftEntries = await redisClient.keys(responseEntryPattern);

		if (leftEntries.length > 0) {
			await redisClient.unlink(...leftEntries);
		}

		await redisClient.del(flushLockKey, buildIdentityKey);
		await redisClient.quit();
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'a boot flush releases the flush lock only while it holds it',
			({ given, when, then, and }) => {
				// A flush walks every key of the response cache, one page at a time:
				// 100000 hold it for long enough to be caught holding the lock.
				given('the response cache holds 100000 entries', async () => {
					for (let page = 0; page < 10; page++) {
						const seeding = redisClient.pipeline();

						for (let entry = 0; entry < 10_000; entry++) {
							seeding.set(
								`${responseEntryPrefix}seeded-${page}-${entry}`,
								'seeded',
								'EX',
								120,
							);
						}

						await seeding.exec();
					}
				});

				// What an instance claiming a lock that expired under a slow flush
				// writes: XX, so it lands only while the boot holds the lock.
				when(
					oneLine`
						another instance takes the flush lock while a boot on a new build
						flushes
					`,
					async () => {
						const port = await getPort();
						env[vendor].PORT = String(port);

						instance = spawn('node', [paths.cli, 'start'], {
							cwd: paths.cwd,
							env: env[vendor],
						});

						await expect.poll(() => {
							return redisClient.set(
								flushLockKey,
								'another-instance',
								'PX',
								60_000,
								'XX',
							);
						}, { interval: 5, timeout: 30_000 }).toBe('OK');

						// The boot listens once its flush has released the lock.
						await awaitDirectusConnection(port);
					},
				);

				then('the boot flushed the 100000 entries', async () => {
					expect(await redisClient.keys(responseEntryPattern)).toEqual([]);
				});

				and(
					oneLine`
						the flush lock still names the other instance, as the flush no
						longer held it
					`,
					async () => {
						expect(await redisClient.get(flushLockKey))
							.toBe('another-instance');
					},
				);
			},
			90_000,
		);
	});
});
