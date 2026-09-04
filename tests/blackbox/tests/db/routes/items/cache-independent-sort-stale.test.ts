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

// RED until fixed. An enforced-FK M2O keyed by pk is `independent`; add a
// scoped_cache_field to it and a sort across it is kept out of `beyond`
// (read-tags.ts: sorted && !hasCoveringSlice is false), then `independent` +
// !nested + !beyond is skipped in readTags (item-scoped-cache-service.ts) — so
// it gets NO tag and no covering pin, and a reorder serves a stale HIT.
const ROOT = 'indep_sort_root';
const CHILD = 'indep_sort_child';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	an independent + sorted M2O with a scoped field gets no tag, so a reorder
	serves a stale HIT
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-indep-sort-${vendor}`;

		let instance: ChildProcess;
		let alphaChildId: number;
		let betaChildId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ROOT,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
					{
						// A flat scope field makes hasCoveringSlice true, which is
						// what keeps the sorted collection out of `beyond`.
						collection: CHILD,
						meta: { scoped_cache_fields: ['name'] },
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
				],
			});

			// An enforced FK: `nearRowAnswerKeys` needs `relation.schema`, so a
			// filter by the child pk classifies the child as `independent`.
			await CreateFieldM2O(vendor, {
				collection: ROOT,
				field: 'cfk',
				otherCollection: CHILD,
			});

			const children = await CreateItem(vendor, {
				collection: CHILD,
				item: [{ name: 'Alpha' }, { name: 'Beta' }],
			});

			alphaChildId = children[0].id;
			betaChildId = children[1].id;

			await CreateItem(vendor, {
				collection: ROOT,
				item: [
					{ label: 'points-at-alpha', cfk: alphaChildId },
					{ label: 'points-at-beta', cfk: betaChildId },
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

			await DeleteCollection(vendor, { collection: ROOT });
			await DeleteCollection(vendor, { collection: CHILD });
		});

		// The filter keys the child by pk (independent), the sort is on
		// `cfk.name`, and `name` is NOT selected — a sort-only relation makes no
		// nested node, so the child is independent + sorted + covering-slice.
		function readRootsSortedByChildName() {
			return request(getUrl(vendor, env))
				.get(`/items/${ROOT}`)
				.query({
					'filter[cfk][id][_in]': `${alphaChildId},${betaChildId}`,
					sort: 'cfk.name',
					fields: 'id,cfk',
				})
				.set('Authorization', auth);
		}

		function renameChild(id: number, name: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${CHILD}/${id}`)
				.send({ name })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			serves the new row order after a rename reorders the sorted child
		`, async () => {
			await clearCache();

			expect(
				(await readRootsSortedByChildName()).headers[cacheStatusHeader],
			).toBe('MISS');

			const warm = await readRootsSortedByChildName();
			expect(warm.headers[cacheStatusHeader]).toBe('HIT');

			// Ascending by child name: Alpha, Beta → [alpha-root, beta-root].
			const warmOrder = warm.body.data.map((row: { id: number }) => row.id);
			expect(warmOrder).toHaveLength(2);

			// Alpha → Zeta moves that root after Beta, flipping the two-row order.
			await renameChild(alphaChildId, 'Zeta');

			const reread = await readRootsSortedByChildName();

			// The hard RED: with no tag on the child the reorder is not caught, so
			// the read stays a stale HIT and returns the OLD order.
			expect(
				reread.body.data.map((row: { id: number }) => row.id),
			).toEqual([...warmOrder].reverse());
		});

		it(oneLine`
			carries a tag for the sorted child so a reorder is catchable
		`, async () => {
			const tags =
				(await readRootsSortedByChildName()).headers[cacheTagsHeader];

			// A bare `CHILD` or any `CHILD:field=value` slice makes the reorder
			// catchable; today the path emits neither, so this is RED too.
			expect(tags).toMatch(new RegExp(`(^|, )${CHILD}(:|,|$)`));
		});
	});
});
