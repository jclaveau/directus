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

// RED until fixed: a stale HIT on a slice a direct self-relation SET NULL moves rows
// out of. `scopedCacheCollectionsChangedByOnDelete` (api/src/scoped-cache/purge.ts)
// deliberately excludes a direct self-relation that only rewrites the FK. Deleting a
// parent X rewrites every child's `parent` FK (X -> NULL) at the database level,
// carrying those rows out of slice `parent=X`; the delete purges only the deleted
// row's own slices plus the bare collection tag, and a value-slice read is filed
// under the slice, not the bare tag. Nothing purges slice `parent=X`, so a read
// `filter[parent][_eq]=X` cached before the delete keeps serving the rows that have
// since left it.

const CATEGORY = 'test_items_self_setnull_category';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-cache-tags';
// const purgedTagsHeader = 'x-cache-purged-tags';

describe(oneLine`
	deleting a parent leaves stale the parent-slice of children a self-relation
	SET NULL rewrites the foreign key of
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		// Proves the reads below are pinned to a value slice, not the bare tag.
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		// env[vendor]['CACHE_PURGED_TAGS_HEADER'] = purgedTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-self-setnull-${vendor}`;

		let instance: ChildProcess;
		let doomedParent: number;
		let survivingParent: number;

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			// Sliced by `parent` (the self-FK itself): a read bounded to one parent id
			// is indexed under that slice alone, never under the bare collection tag.
			await CreateCollections(vendor, {
				collections: [{
					collection: CATEGORY,
					meta: { scoped_cache_fields: ['parent'] },
					fields: [{ field: 'name', type: 'string', meta: {} }],
				}],
			});

			// The subject: a direct self-relation whose SET NULL rewrites a child's FK
			// on delete rather than removing the row. The excluded case in purge.ts.
			await CreateFieldM2O(vendor, {
				collection: CATEGORY,
				field: 'parent',
				otherCollection: CATEGORY,
				relationSchema: { on_delete: 'SET NULL' },
			});

			const roots = await CreateItem(vendor, {
				collection: CATEGORY,
				item: [{ name: 'doomed' }, { name: 'survivor' }],
			});

			doomedParent = roots[0].id;
			survivingParent = roots[1].id;

			await CreateItem(vendor, {
				collection: CATEGORY,
				item: [
					{ name: 'a', parent: doomedParent },
					{ name: 'b', parent: doomedParent },
					{ name: 'c', parent: survivingParent },
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

			await DeleteCollection(vendor, { collection: CATEGORY });
		});

		function readSlice(parent: number) {
			const sliceQuery = `fields=id,name&filter[parent][_eq]=${parent}`;

			return request(getUrl(vendor, env))
				.get(`/items/${CATEGORY}?${sliceQuery}`)
				.set('Authorization', auth);
		}

		it(oneLine`
			deleting a parent purges the slice of children whose foreign key it sets to
			null, so the slice does not keep serving them
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const [doomedSlice, keptSlice] = await Promise.all([
				readSlice(doomedParent),
				readSlice(survivingParent),
			]);

			expect(doomedSlice.headers[cacheStatusHeader]).toBe('MISS');
			expect(keptSlice.headers[cacheStatusHeader]).toBe('MISS');

			// Non-vacuity: the reads are pinned to their value slice, so the bare
			// collection tag the delete already emits never reaches them.
			expect(doomedSlice.headers[cacheTagsHeader])
			.toBe(`${CATEGORY}:parent=${doomedParent}`);

			expect(keptSlice.headers[cacheTagsHeader])
			.toBe(`${CATEGORY}:parent=${survivingParent}`);

			expect(doomedSlice.body.data).toHaveLength(2);
			expect(keptSlice.body.data).toHaveLength(1);

			await request(url)
				.delete(`/items/${CATEGORY}/${doomedParent}`)
				.set('Authorization', auth);

			const [doomedAfter, keptAfter] = await Promise.all([
				readSlice(doomedParent),
				readSlice(survivingParent),
			]);

			// The hard soundness proof: the database rewrote a and b's `parent` FK to
			// null, carrying them out of `parent=doomedParent`. A stale HIT keeps
			// serving them here; the slice must now be empty.
			expect(doomedAfter.body.data).toHaveLength(0);
			expect(doomedAfter.headers[cacheStatusHeader]).toBe('MISS');

			// The control: nothing rewrote the surviving parent's children, and the
			// delete is not a whole-namespace flush, so this slice stays warm.
			expect(keptAfter.headers[cacheStatusHeader]).toBe('HIT');
			expect(keptAfter.body.data).toHaveLength(1);

			// Secondary (commented — exact post-fix tag form unresolved): after the fix
			// the delete's CACHE_PURGED_TAGS_HEADER should carry a tag dropping
			// `${CATEGORY}:parent=${doomedParent}`; today it carries only the deleted
			// row's own slices and the bare collection tag.
		});
	});
});
