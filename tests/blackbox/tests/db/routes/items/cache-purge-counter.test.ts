import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	type StepFunctions,
} from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
} from 'vitest';

const SLOT = 'purge_counter_slot';

const feature = loadFeature(
	'./tests/db/routes/items/cache-purge-counter.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = `directus-purge-counter-${vendor}`;

	const slotEpochKey
		= `${env[vendor]['CACHE_NAMESPACE']}:scoped-cache-epoch:${SLOT}`;

	// Each scenario boots its own instance, since the duration is read at boot.
	let instance: ChildProcess | undefined;

	const redis = new Redis({
		host: env[vendor]['REDIS_HOST'],
		port: Number(env[vendor]['REDIS_PORT']),
	});

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [{
				collection: SLOT,
				meta: { scoped_cache_fields: ['owner'] },
				fields: [{ field: 'owner', type: 'string', meta: {} }],
			}],
		});
	});

	afterEach(() => {
		instance?.kill();
		instance = undefined;
	});

	afterAll(async () => {
		await redis.del(slotEpochKey);
		await redis.quit();

		await DeleteCollection(vendor, { collection: SLOT });
	});

	function defineScenarioSteps({ given, and, when, then }: StepFunctions) {
		given(
			/^an instance holding purge counters for "(.*)"$/,
			async (epochTtl: string) => {
				const instanceEnv = cloneDeep(env);
				const port = await getPort();

				instanceEnv[vendor]['CACHE_SCOPED_EPOCH_TTL'] = epochTtl;
				instanceEnv[vendor].PORT = String(port);
				env[vendor].PORT = String(port);

				instance = spawn('node', [paths.cli, 'start'], {
					cwd: paths.cwd,
					env: instanceEnv[vendor],
				});

				await awaitDirectusConnection(port);
			},
		);

		and('the slots have no purge counter', async () => {
			await redis.del(slotEpochKey);
		});

		when('a slot is created', async () => {
			const created = await request(getUrl(vendor, env))
				.post(`/items/${SLOT}`)
				.send({ owner: 'alpha' })
				.set('Authorization', auth);

			expect(created.statusCode).toBe(200);
		});

		then.optional(
			/^the slots' purge counter is held between (\d+) and (\d+) seconds$/,
			async (shortestHold: string, longestHold: string) => {
				const heldFor = await redis.ttl(slotEpochKey);

				expect(heldFor).toBeGreaterThanOrEqual(Number(shortestHold));
				expect(heldFor).toBeLessThanOrEqual(Number(longestHold));
			},
		);

		then.optional('the slots\' purge counter reads sixteen digits', async () => {
			expect(await redis.get(slotEpochKey)).toMatch(/^\d{16}$/);
		});
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a purge counter held for 0 seconds is held for the 24h default',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'a purge counter held for 10 seconds is held for 5 minutes',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'a missing purge counter starts at the Redis clock in microseconds',
			defineScenarioSteps,
			60_000,
		);
	});
});
