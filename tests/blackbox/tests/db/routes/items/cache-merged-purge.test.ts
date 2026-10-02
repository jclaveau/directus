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
import getPort from 'get-port';
import Redis from 'ioredis';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep, omit } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

// The names extensions/cache-merged-purge hard-codes.
const ROW = 'merged_purge_row';
const SIGNAL = 'merged_purge_signal';
const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature('./tests/db/routes/items/cache-merged-purge.feature');

describe.each(vendors)('%s', (vendor) => {
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = `directus-merged-purge-${vendor}`;

	const rowEpochKey
		= `${env[vendor]['CACHE_NAMESPACE']}:scoped-cache-epoch:${ROW}`;

	const redis = new Redis({
		host: env[vendor]['REDIS_HOST'],
		port: Number(env[vendor]['REDIS_PORT']),
	});

	const auth = `Bearer ${USER.ADMIN.TOKEN}`;
	let instance: ChildProcess;

	// How far each signal moved the rows' purge counter, in the order they ran.
	const counterMoves: number[] = [];

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [
				{
					collection: ROW,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'revision', type: 'integer', meta: {} },
					],
				},
				{
					collection: SIGNAL,
					fields: [
						{ field: 'updated_ids', type: 'json', meta: {} },
						{ field: 'updated_values', type: 'json', meta: {} },
					],
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

		await redis.del(rowEpochKey);
		await redis.quit();

		await DeleteCollection(vendor, { collection: SIGNAL });
		await DeleteCollection(vendor, { collection: ROW });
	});

	// As in `cache-declared-pin-readback.test.ts`: `fields` and `sort` go as lists,
	// anything nested as JSON.
	function readRows(query: string) {
		const parameters: Record<string, string | string[]> = {};
		const sentQuery = loadYaml(query) as Record<string, unknown>;

		for (const [parameter, value] of Object.entries(sentQuery)) {
			if (typeof value === 'string' || Array.isArray(value)) {
				parameters[parameter] = value;
			}
			else {
				parameters[parameter] = JSON.stringify(value);
			}
		}

		return request(getUrl(vendor, env))
			.get(`/items/${ROW}`)
			.query(parameters)
			.set('Authorization', auth);
	}

	async function createRows(table: Record<string, string>[]) {
		const created = await request(getUrl(vendor, env))
			.post(`/items/${ROW}`)
			.send(parseGherkinTable(table).map((row) => omit(row, 'markers')))
			.set('Authorization', auth);

		expect(created.statusCode).toBe(200);
	}

	async function createSignal(table: Record<string, string>[]) {
		const counterBefore = Number(await redis.get(rowEpochKey));

		const created = await request(getUrl(vendor, env))
			.post(`/items/${SIGNAL}`)
			.send(parseGherkinTable(table)[0])
			.set('Authorization', auth);

		expect(created.statusCode).toBe(200);

		counterMoves.push(Number(await redis.get(rowEpochKey)) - counterBefore);
	}

	async function expectCached(table: Record<string, string>[]) {
		for (const row of table) {
			expect((await readRows(row['query']!)).headers[cacheStatusHeader])
				.toBe('MISS');

			// Polled: the reap the boot asks for can move the purge counter under
			// the first fill, which then evicts what it wrote.
			await expect.poll(async () => {
				return (await readRows(row['query']!)).headers[cacheStatusHeader];
			}, { timeout: 5_000 }).toBe('HIT');

			const cached = await readRows(row['query']!);

			expect(cached.headers[cacheStatusHeader]).toBe('HIT');
			expect(cached.body.data).toEqual(loadYaml(row['response']!));
		}
	}

	async function expectAnswer(
		table: Record<string, string>[],
		cacheStatus: 'HIT' | 'MISS',
	) {
		for (const row of table) {
			const answered = await readRows(row['query']!);

			expect(answered.headers[cacheStatusHeader]).toBe(cacheStatus);
			expect(answered.body.data).toEqual(loadYaml(row['response']!));
		}
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'five rows updated one by one purge their collection once',
			({ given, when, and, then }) => {
				given(`these rows of ${ROW}:`, createRows);

				when('a signal updates these rows one by one:', (table) => {
					counterMoves.length = 0;

					return createSignal(table);
				});

				and('a signal updates these rows one by one:', createSignal);

				then(
					'the second signal moved the rows\' purge counter as much as the '
						+ 'first',
					() => {
						// Five purges, one per row, would move it five times as far.
						expect(counterMoves[1]).toBe(counterMoves[0]);
						expect(counterMoves[0]).toBeGreaterThan(0);
					},
				);
			},
			60_000,
		);

		scenario(
			'the merged purge drops the reads of every row it names and spares the '
				+ 'others',
			({ given, and, when, then }) => {
				given(`these rows of ${ROW}:`, createRows);

				and('these reads are cached:', expectCached);

				when('a signal updates these rows one by one:', createSignal);

				then(
					'north_2 and south_2 are purged, as each names a row the signal '
						+ 'updated:',
					(table) => expectAnswer(table, 'MISS'),
				);

				and(
					'witness_2 is still cached, as no row the signal updated reaches '
						+ 'it:',
					(table) => expectAnswer(table, 'HIT'),
				);
			},
			60_000,
		);
	});
});
