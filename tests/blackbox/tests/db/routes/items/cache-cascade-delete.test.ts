import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
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

// Scoped purging is driven by ItemsService: snapshot the mutated collection's
// scope values, then purge its tags. A database-level ON DELETE CASCADE never
// goes through the service — no call, no items.delete event, no snapshot, no
// purge — so deleting a parent removes the child rows underneath while their
// cache entries stay indexed and servable until TTL. Reads of a collection
// reachable only by cascade therefore serve rows that no longer exist, and a
// grandchild cascades just as silently.

const PARENT = 'test_items_cascade_parent';
const CHILD = 'test_items_cascade_child';
const GRANDCHILD = 'test_items_cascade_grandchild';
const SIBLING = 'test_items_cascade_sibling';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	deleting a parent purges the collections its foreign keys cascade into
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-cascade-${vendor}`;

		let instance: ChildProcess;
		let doomedParent: number;

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [PARENT, CHILD, GRANDCHILD, SIBLING].map((collection) => {
					return {
						collection,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					};
				}),
			});

			// The cascade is the subject: SET NULL (the helper's default) would leave the
			// child rows in place and there would be nothing to go stale.
			await CreateFieldM2O(vendor, {
				collection: CHILD,
				field: 'parent',
				otherCollection: PARENT,
				relationSchema: { on_delete: 'CASCADE' },
			});

			await CreateFieldM2O(vendor, {
				collection: GRANDCHILD,
				field: 'child',
				otherCollection: CHILD,
				relationSchema: { on_delete: 'CASCADE' },
			});

			const parents = await CreateItem(vendor, {
				collection: PARENT,
				item: [{ label: 'doomed' }],
			});

			doomedParent = parents[0].id;

			const children = await CreateItem(vendor, {
				collection: CHILD,
				item: [{ label: 'child-of-doomed', parent: doomedParent }],
			});

			await Promise.all([
				CreateItem(vendor, {
					collection: GRANDCHILD,
					item: [{ label: 'grandchild-of-doomed', child: children[0].id }],
				}),
				CreateItem(vendor, {
					collection: SIBLING,
					item: [{ label: 'untouched' }],
				}),
			]);

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

			// Grandchild first: its FK holds the child, and the child's holds the parent.
			await DeleteCollection(vendor, { collection: GRANDCHILD });
			await DeleteCollection(vendor, { collection: CHILD });

			await Promise.all([
				DeleteCollection(vendor, { collection: PARENT }),
				DeleteCollection(vendor, { collection: SIBLING }),
			]);
		});

		function read(collection: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.set('Authorization', auth);
		}

		it(oneLine`
			a cascaded child and grandchild go cold with the parent, while an unrelated
			collection stays warm
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const warmed = await Promise.all([
				read(CHILD),
				read(GRANDCHILD),
				read(SIBLING),
			]);

			for (const response of warmed) {
				expect(response.headers[cacheStatusHeader]).toBe('MISS');
			}

			await request(url)
				.delete(`/items/${PARENT}/${doomedParent}`)
				.set('Authorization', auth);

			const [child, grandchild, sibling] = await Promise.all([
				read(CHILD),
				read(GRANDCHILD),
				read(SIBLING),
			]);

			expect(child.headers[cacheStatusHeader]).toBe('MISS');
			expect(grandchild.headers[cacheStatusHeader]).toBe('MISS');

			// The control: a coarse "purge everything on any delete" would drop this too,
			// so it is what keeps the assertions above meaningful.
			expect(sibling.headers[cacheStatusHeader]).toBe('HIT');

			// Non-vacuity: the rows really did cascade away, so a served HIT above would
			// have been a cache entry describing rows that no longer exist.
			expect(child.body.data).toHaveLength(0);
			expect(grandchild.body.data).toHaveLength(0);
			expect(sibling.body.data).toHaveLength(1);
		});
	});
});
