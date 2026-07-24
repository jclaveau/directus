import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateItem, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// End-to-end witness that a mutation hook's SIDE-EFFECT write to another collection
// — a plain `ItemsService` write, NOT a `scopedCache.purgeBy` declaration — self-
// purges that collection's scoped cache (#292). A filter hook on the source update
// runs a bookkeeping `updateMany` on `target[space=x]` (the cache-nested-write
// extension). The nested write is a real ItemsService mutation, so it runs target's
// own purge pipeline: target[x] MISSes after the source update, precisely — the
// sibling target[y] stays warm, and no `purgeBy` is declared anywhere. This is the
// framework floor a hook author leans on; `purgeBy` is only for writes that bypass
// ItemsService or suppress its purge.

const SOURCE = 'test_nested_source';
const TARGET = 'test_nested_target';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	a mutation hook's nested ItemsService write to another collection self-purges that
	collection's scoped cache — no purgeBy needed (#292)
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-nested-write-${vendor}`;

		let instance: ChildProcess;
		let sourceA: number;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns, so it sees
			// both collections (+ their `scoped_cache_fields`) on boot. Both scoped by
			// `space`; the hook bumps target[space=x] whenever a source row is updated.
			await CreateCollections(vendor, {
				collections: [
					{
						collection: SOURCE,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'note', type: 'string' },
						],
					},
					{
						collection: TARGET,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string' },
							{ field: 'tally', type: 'integer' },
						],
					},
				],
			});

			const [sources] = await Promise.all([
				CreateItem(vendor, {
					collection: SOURCE,
					item: [{ space: 's', note: 'orig' }],
				}),
				CreateItem(vendor, {
					collection: TARGET,
					item: [
						{ space: 'x', tally: 0 },
						{ space: 'y', tally: 0 },
					],
				}),
			]);

			sourceA = sources[0].id;

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

			await Promise.all([
				DeleteCollection(vendor, { collection: SOURCE }),
				DeleteCollection(vendor, { collection: TARGET }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readSlice(collection: string, space: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.query({ 'filter[space][_eq]': space })
				.set('Authorization', auth);
		}

		it(oneLine`
			updating a source row runs the hook's nested write on target[x], whose own
			purge drops target[x] — the sibling target[y] stays warm, no purgeBy declared
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm both target slices.
			await Promise.all([readSlice(TARGET, 'x'), readSlice(TARGET, 'y')]);

			// Update the source: the filter hook's nested write bumps target[x].
			await request(url)
				.patch(`/items/${SOURCE}/${sourceA}`)
				.send({ note: 'touched' })
				.set('Authorization', auth);

			const [x, y] = await Promise.all([
				readSlice(TARGET, 'x'),
				readSlice(TARGET, 'y'),
			]);

			// The nested write self-purged target[x] — MISS, and the write landed.
			expect(x.headers[cacheStatusHeader]).toBe('MISS');
			expect(x.body.data[0].tally).toBe(1);
			// The sibling slice the hook never touched stays warm.
			expect(y.headers[cacheStatusHeader]).toBe('HIT');
		});
	});
});
