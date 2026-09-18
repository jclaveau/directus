import config, { getUrl, paths } from '@common/config';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A batch create reads its rows back pinned one per key, so a 400-row uuid
// batch answers with ~20kb of tags: past node's 16kb header cap every client
// fails the request over a write that went through. The dev headers stop at
// CACHE_TAGS_HEADER_MAX_SIZE (4kb by default) on a whole tag, and count the
// rest in a `-omitted` sibling.
const DEFAULT_MAX_SIZE = 4 * 1024;
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';
const cachePurgedTagsHeader = 'x-scoped-cache-purged-tags';
const auth = `Bearer ${USER.ADMIN.TOKEN}`;

type Booted = {
	env: typeof config.envs;
	instance: ChildProcess;
};

// One instance per cap: the cap is read out of the environment at boot.
async function boot(
	vendor: string,
	collection: string,
	rows: number,
	maxSize?: string,
): Promise<Booted> {
	const env = cloneDeep(config.envs);
	env[vendor]['CACHE_ENABLED'] = 'true';
	env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
	env[vendor]['CACHE_PURGED_TAGS_HEADER'] = cachePurgedTagsHeader;
	env[vendor]['CACHE_AUTO_PURGE'] = 'true';
	env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
	env[vendor]['CACHE_STORE'] = 'redis';
	env[vendor]['REDIS_HOST'] = 'localhost';
	env[vendor]['REDIS_PORT'] = '6108';
	env[vendor]['CACHE_NAMESPACE'] = `directus-tags-header-clamp-${collection}`;

	// The shared config caps a batch at 100 rows, well under the header cap.
	env[vendor]['MAX_BATCH_MUTATION'] = String(rows);

	if (maxSize !== undefined) {
		env[vendor]['CACHE_TAGS_HEADER_MAX_SIZE'] = maxSize;
	}

	await CreateCollections(vendor, {
		collections: [
			{
				collection,
				primaryKeyType: 'uuid',
				fields: [{ field: 'name', type: 'string', meta: {} }],
			},
		],
	});

	const port = await getPort();
	env[vendor].PORT = String(port);

	const instance = spawn('node', [paths.cli, 'start'], {
		cwd: paths.cwd,
		env: env[vendor],
	});

	await awaitDirectusConnection(port);

	return { env, instance };
}

function createRows(
	vendor: string,
	env: typeof config.envs,
	collection: string,
	rows: number,
) {
	return request(getUrl(vendor, env))
		.post(`/items/${collection}`)
		.send(Array.from({ length: rows }, (_, i) => ({ name: `row ${i}` })))
		.set('Authorization', auth);
}

describe(oneLine`
	the dev tag headers stop at CACHE_TAGS_HEADER_MAX_SIZE instead of overflowing
	the client
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		describe('under the 4kb default', () => {
			const ROW = 'hc_row';
			const ROWS = 400;
			let booted: Booted;

			beforeAll(async () => {
				booted = await boot(vendor, ROW, ROWS);
			}, 60_000);

			afterAll(async () => {
				booted.instance.kill();

				await DeleteCollection(vendor, { collection: ROW });
			});

			it('answers a batch create whose pins outgrow the header cap', async () => {
				const response = await createRows(vendor, booted.env, ROW, ROWS);

				expect(response.status).toBe(200);
				expect(response.body.data).toHaveLength(ROWS);

				const tags: string = response.headers[cacheTagsHeader];
				const omitted = Number(response.headers[`${cacheTagsHeader}-omitted`]);
				const kept = tags.split(', ');

				expect(tags.length).toBeLessThanOrEqual(DEFAULT_MAX_SIZE);
				expect(omitted).toBeGreaterThan(0);

				// Cut on a tag boundary, never inside one.
				for (const tag of kept) {
					expect(tag).toMatch(new RegExp(`^${ROW}:id=[0-9a-f-]{36}$`));
				}

				// The header and its omitted count add up to one pin per created row.
				expect(kept.length + omitted).toBe(ROWS);

				const purged: string = response.headers[cachePurgedTagsHeader];
				expect(purged.length).toBeLessThanOrEqual(DEFAULT_MAX_SIZE);
			});
		});

		describe('with the cap switched off', () => {
			const ROW = 'hc_row_uncapped';

			// Past the default cap, under node's 16kb ceiling with the purged
			// header alongside.
			const ROWS = 100;
			let booted: Booted;

			beforeAll(async () => {
				booted = await boot(vendor, ROW, ROWS, '0');
			}, 60_000);

			afterAll(async () => {
				booted.instance.kill();

				await DeleteCollection(vendor, { collection: ROW });
			});

			it('emits every pin and no omitted count', async () => {
				const response = await createRows(vendor, booted.env, ROW, ROWS);

				expect(response.status).toBe(200);

				const tags: string = response.headers[cacheTagsHeader];

				expect(tags.length).toBeGreaterThan(DEFAULT_MAX_SIZE);
				expect(tags.split(', ')).toHaveLength(ROWS);
				expect(response.headers[`${cacheTagsHeader}-omitted`]).toBeUndefined();
			});
		});

		describe('with a cap smaller than one tag', () => {
			const ROW = 'hc_row_tiny';
			const ROWS = 3;
			let booted: Booted;

			beforeAll(async () => {
				booted = await boot(vendor, ROW, ROWS, '10');
			}, 60_000);

			afterAll(async () => {
				booted.instance.kill();

				await DeleteCollection(vendor, { collection: ROW });
			});

			it('leaves the header out and counts every pin as omitted', async () => {
				const response = await createRows(vendor, booted.env, ROW, ROWS);

				expect(response.status).toBe(200);
				expect(response.headers[cacheTagsHeader]).toBeUndefined();
				expect(response.headers[`${cacheTagsHeader}-omitted`]).toBe(String(ROWS));
			});
		});
	});
});
