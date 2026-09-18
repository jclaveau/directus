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
const ROW = 'hc_row';
const ROWS = 400;
const DEFAULT_MAX_SIZE = 4 * 1024;
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';
const cachePurgedTagsHeader = 'x-scoped-cache-purged-tags';

describe(oneLine`
	the dev tag headers stop at CACHE_TAGS_HEADER_MAX_SIZE instead of overflowing
	the client
`, () => {
	describe.each(vendors)('%s', (vendor) => {
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-tags-header-clamp-${vendor}`;

		let instance: ChildProcess;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ROW,
						primaryKeyType: 'uuid',
						fields: [{ field: 'name', type: 'string', meta: {} }],
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

		afterAll(async () => {
			instance.kill();

			await DeleteCollection(vendor, { collection: ROW });
		});

		it('answers a batch create whose pins outgrow the header cap', async () => {
			const response = await request(getUrl(vendor, env))
				.post(`/items/${ROW}`)
				.send(Array.from({ length: ROWS }, (_, i) => ({ name: `row ${i}` })))
				.set('Authorization', auth);

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
});
