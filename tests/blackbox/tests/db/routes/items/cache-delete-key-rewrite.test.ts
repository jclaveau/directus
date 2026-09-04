import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// RED until fixed. `deleteMany` snapshots the scope values off the `items.delete`
// filter's RETURN while the statement below deletes the original keys, so a
// hook rewriting the array (rather than returning null to cancel) purges the
// SURVIVING row's slice and leaves the deleted row's own cached. The
// cache-delete-key-rewrite extension hosts the hook.

const COLLECTION = 'del_rewrite_scoped';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a delete filter that rewrites its key array purges the wrong slices, so the
	deleted row is still served (#428)
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-del-rewrite-${vendor}`;

		let instance: ChildProcess;
		let doomedId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [{
					collection: COLLECTION,
					meta: { scoped_cache_fields: ['slot'] },
					fields: [
						{ field: 'slot', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				}],
			});

			// The hook redirects the purge to the decoy in slot `b`; the row
			// in slot `a` is what actually gets deleted.
			const rows = await CreateItem(vendor, {
				collection: COLLECTION,
				item: [
					{ slot: 'a', label: 'doomed' },
					{ slot: 'b', label: 'decoy' },
				],
			});

			doomedId = rows[0].id;

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance?.kill();

			await DeleteCollection(vendor, { collection: COLLECTION });
		});

		function readSlotA() {
			return request(getUrl(vendor, env))
				.get(`/items/${COLLECTION}`)
				.query({ 'filter[slot][_eq]': 'a' })
				.set('Authorization', auth);
		}

		it(oneLine`
			purges the slice of the row it deleted, not the slice the hook
			named, so the deleted row stops being served
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const warm = await readSlotA();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.headers[cacheTagsHeader]).toEqual(`${COLLECTION}:slot=a`);
			expect(warm.body.data).toHaveLength(1);

			expect((await readSlotA()).headers[cacheStatusHeader]).toBe('HIT');

			await request(getUrl(vendor, env))
				.delete(`/items/${COLLECTION}/${doomedId}`)
				.set('Authorization', auth);

			const after = await readSlotA();

			// RED until fixed: the snapshot named slot `b`, so this entry
			// survived carrying the row the statement removed.
			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data).toHaveLength(0);
		});
	});
});
