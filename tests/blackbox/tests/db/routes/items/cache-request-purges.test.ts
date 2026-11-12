import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
} from '@common/cucumber';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

// The collection extensions/cache-request-purges writes: it takes no collection
// name, so this file creates it under the name it hard-codes.
const LESSON = 'reqpurge_lesson';

const feature = loadFeature(
	'./tests/db/routes/items/cache-request-purges.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = `directus-reqpurge-${vendor}`;

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{
					collection: LESSON,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'revision', type: 'integer', meta: {} },
					],
				},
			],
		});

		env[vendor].PORT = String(await freePortOfWorker());

		instance = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		await awaitDirectusConnection(Number(env[vendor].PORT));
	}, 60_000);

	afterAll(async () => {
		instance.kill();

		await DeleteCollection(vendor, { collection: LESSON });
	});

	async function createRows(table: Record<string, string>[]) {
		const created = await request(getUrl(vendor, env))
			.post(`/items/${LESSON}`)
			.send(parseGherkinTable(table))
			.set('Authorization', auth);

		expect(created.statusCode).toBe(200);
	}

	async function expectRequestPurges(table: Record<string, string>[]) {
		for (const row of table) {
			const { route, keys } = loadYaml(row['request']!) as {
				route: string;
				keys: number[];
			};

			const answered = await request(getUrl(vendor, env))
				.post(`/cache-request-purges/${route}`)
				.send({ keys })
				.set('Authorization', auth);

			expect(answered.statusCode).toBe(200);
			expect(answered.body).toEqual(loadYaml(row['response']!));
		}
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'an items-service update names the slices it purged',
			({ given, when }) => {
				given(`these rows of ${LESSON}:`, createRows);

				when(
					'the endpoint writes and answers what the request purged:',
					expectRequestPurges,
				);
			},
			60_000,
		);

		scenario(
			'two updates of one request are both named, in order',
			({ given, when }) => {
				given(`these rows of ${LESSON}:`, createRows);

				when(
					'the endpoint writes and answers what the request purged:',
					expectRequestPurges,
				);
			},
			60_000,
		);

		scenario(
			'an update inside a raw transaction is named once it committed',
			({ given, when }) => {
				given(`these rows of ${LESSON}:`, createRows);

				when(
					'the endpoint writes and answers what the request purged:',
					expectRequestPurges,
				);
			},
			60_000,
		);

		scenario(
			'a raw write handed to purgeForMutatedRows is named',
			({ given, when }) => {
				given(`these rows of ${LESSON}:`, createRows);

				when(
					'the endpoint writes and answers what the request purged:',
					expectRequestPurges,
				);
			},
			60_000,
		);

		scenario(
			'a request writing nothing reads an empty list',
			({ when }) => {
				when(
					'the endpoint writes and answers what the request purged:',
					expectRequestPurges,
				);
			},
			60_000,
		);
	});
});
