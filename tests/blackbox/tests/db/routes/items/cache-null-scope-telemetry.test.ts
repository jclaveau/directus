import config, { getUrl, paths } from '@common/config';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// #370 escaped the NULL scope token on its way into the HTTP headers but left the
// label raw, since the Redis key is built from it. That label is ALSO persisted,
// and Postgres rejects 0x00 in a text column outright. The drain wraps one whole
// tick in a single transaction, so one such tag rolls back every cache-stats event
// batched with it — hits, misses, fills, purges — behind a warning nobody reads.

const COLLECTION = 'test_items_null_scope_telemetry';
const PURGE_TAGS = 'directus_cache_stats_scoped_purge_tags';

describe(oneLine`
	a purge whose scope value is null persists its attribution instead of taking the
	telemetry batch down with it
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-null-telemetry-${vendor}`;
		env[vendor]['CACHE_STATS_ENABLED'] = 'true';

		let instance: ChildProcess;
		let db: Knex;

		beforeAll(async () => {
			// Seeded before the scoped instance spawns so it reads `scoped_cache_fields`
			// on boot. `owner` is nullable, which is the whole point.
			await CreateCollections(vendor, {
				collections: [{
					collection: COLLECTION,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'amount', type: 'string', meta: {} },
					],
				}],
			});

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			db = knex(config.knexConfig[vendor]!);

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance.kill();

			await db.destroy();
			await DeleteCollection(vendor, { collection: COLLECTION });
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function createItem(item: Record<string, string>) {
			return request(getUrl(vendor, env))
				.post(`/items/${COLLECTION}`)
				.send(item)
				.set('Authorization', auth);
		}

		// The drain is a ten-second cron, so rows land some ticks after the write.
		async function awaitPurgeTag(tag: string): Promise<string[]> {
			for (let attempt = 0; attempt < 40; attempt++) {
				const rows = await db(PURGE_TAGS)
					.where({ collection: COLLECTION })
					.select('scoped_cache_tag');

				const tags = rows.map((row: any) => row.scoped_cache_tag);

				if (tags.includes(tag)) {
					return tags;
				}

				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			return [];
		}

		// Runs first on purpose: it proves the telemetry pipeline reaches Postgres at
		// all, so the null case below fails for its own reason rather than a dead drain.
		it(oneLine`
			persists the attribution of a purge carrying a plain scope value
		`, async () => {
			const created = await createItem({ owner: 'acme', amount: '5' });
			expect(created.statusCode).toBe(200);

			const tags = await awaitPurgeTag(`${COLLECTION}:owner=acme`);
			expect(tags).toContain(`${COLLECTION}:owner=acme`);
		}, 60_000);

		it(oneLine`
			persists the attribution of a purge whose scope value is null
		`, async () => {
			const created = await createItem({ amount: '7' });
			expect(created.statusCode).toBe(200);
			expect(created.body.data.owner).toBe(null);

			const tags = await awaitPurgeTag(`${COLLECTION}:owner=%00null`);
			expect(tags).toContain(`${COLLECTION}:owner=%00null`);
		}, 60_000);
	});
});
