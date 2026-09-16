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

// Deleting a parent through a direct self-relation that SETS NULL / SETS DEFAULT
// rewrites the surviving children's fk at the database level: they are changed
// rows. The delete purges the vacated `parent=<deleted>` slice and nothing else of
// theirs, so every other slice a survivor sits in — its own key, another scope
// field — keeps serving the fk the database already rewrote, and the slice the
// survivors ARRIVE in (the default) keeps missing them.
const NODE = 'selfsurv_node';
const OWNED = 'selfsurv_owned';
const DEFAULTED = 'selfsurv_defaulted';
const FALLBACK_ID = 900001;
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

// InnoDB rejects a table definition carrying ON DELETE SET DEFAULT and Oracle has no
// such rule at all; postgres, sqlite and mssql all take it.
const vendorsRejectingSetDefault = ['mysql', 'mysql5', 'maria', 'oracle'];

describe(oneLine`
	deleting a self-relation parent purges every slice its surviving children sit in
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-self-survivor-slices-${vendor}`;

		let instance: ChildProcess;
		let doomedNodeId: number;
		let survivorNodeId: number;
		let bystanderNodeId: number;
		let doomedOwnedId: number;
		let doomedDefaultedId: number;
		let keptDefaultedId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;
		const supportsSetDefault = vendorsRejectingSetDefault.includes(vendor) === false;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					// No scope field: the key axis alone pins its reads.
					{
						collection: NODE,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: OWNED,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [{ field: 'owner', type: 'integer', meta: {} }],
					},
					...(supportsSetDefault
						? [{
							collection: DEFAULTED,
							meta: { scoped_cache_fields: ['parent'] },
							fields: [{ field: 'name', type: 'string', meta: {} }],
						}]
						: []),
				],
			});

			for (const collection of [NODE, OWNED]) {
				await CreateFieldM2O(vendor, {
					collection,
					field: 'parent',
					otherCollection: collection,
					relationSchema: { on_delete: 'SET NULL' },
				});
			}

			const roots = await CreateItem(vendor, {
				collection: NODE,
				item: [{ name: 'doomed' }, { name: 'kept' }],
			});

			doomedNodeId = roots[0].id;

			const nodes = await CreateItem(vendor, {
				collection: NODE,
				item: [
					{ name: 'survivor', parent: doomedNodeId },
					{ name: 'bystander', parent: roots[1].id },
				],
			});

			survivorNodeId = nodes[0].id;
			bystanderNodeId = nodes[1].id;

			// The doomed root sits in a slice no reader pins: its own capture must not
			// be what evicts the survivors' slice.
			const ownedRoots = await CreateItem(vendor, {
				collection: OWNED,
				item: [{ owner: 3 }, { owner: 2 }],
			});

			doomedOwnedId = ownedRoots[0].id;

			await CreateItem(vendor, {
				collection: OWNED,
				item: [
					{ owner: 1, parent: doomedOwnedId },
					{ owner: 1, parent: doomedOwnedId },
					{ owner: 2, parent: ownedRoots[1].id },
				],
			});

			if (supportsSetDefault) {
				// The fallback row is written under an explicit key so the column
				// default can name it before any row exists.
				await CreateItem(vendor, {
					collection: DEFAULTED,
					item: [{ id: FALLBACK_ID, name: 'fallback' }],
				});

				await CreateFieldM2O(vendor, {
					collection: DEFAULTED,
					field: 'parent',
					otherCollection: DEFAULTED,
					fieldSchema: { default_value: FALLBACK_ID },
					relationSchema: { on_delete: 'SET DEFAULT' },
				});

				// Adding the column defaulted every row already there into the fallback
				// slice; the roots are pulled out of it so only `d` starts inside.
				await request(getUrl(vendor, env))
					.patch(`/items/${DEFAULTED}/${FALLBACK_ID}`)
					.send({ parent: null })
					.set('Authorization', auth);

				const defaultedRoots = await CreateItem(vendor, {
					collection: DEFAULTED,
					item: [{ name: 'doomed', parent: null }, { name: 'kept', parent: null }],
				});

				doomedDefaultedId = defaultedRoots[0].id;
				keptDefaultedId = defaultedRoots[1].id;

				await CreateItem(vendor, {
					collection: DEFAULTED,
					item: [
						{ name: 'a', parent: doomedDefaultedId },
						{ name: 'b', parent: doomedDefaultedId },
						{ name: 'c', parent: keptDefaultedId },
						{ name: 'd', parent: FALLBACK_ID },
					],
				});
			}

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

			await DeleteCollection(vendor, { collection: NODE });
			await DeleteCollection(vendor, { collection: OWNED });

			if (supportsSetDefault) {
				await DeleteCollection(vendor, { collection: DEFAULTED });
			}
		});

		function readNode(id: number) {
			return request(getUrl(vendor, env))
				.get(`/items/${NODE}/${id}`)
				.query({ fields: 'id,parent' })
				.set('Authorization', auth);
		}

		function readOwned(owner: number) {
			return request(getUrl(vendor, env))
				.get(`/items/${OWNED}`)
				.query({ fields: 'id,parent', sort: 'id', 'filter[owner][_eq]': owner })
				.set('Authorization', auth);
		}

		function readDefaulted(parent: number) {
			return request(getUrl(vendor, env))
				.get(`/items/${DEFAULTED}`)
				.query({ fields: 'id', sort: 'id', 'filter[parent][_eq]': parent })
				.set('Authorization', auth);
		}

		it(oneLine`
			deleting the parent evicts a survivor read pinned on its own key, and leaves
			a bystander's warm
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const [survivor, bystander] = await Promise.all([
				readNode(survivorNodeId),
				readNode(bystanderNodeId),
			]);

			expect(survivor.headers[cacheStatusHeader]).toBe('MISS');
			expect(bystander.headers[cacheStatusHeader]).toBe('MISS');

			// Non-vacuity: the key slice alone, which the bare tag a delete emits
			// never reaches.
			expect(survivor.headers[cacheTagsHeader])
				.toBe(`${NODE}:id=${survivorNodeId}`);

			expect(survivor.body.data.parent).toBe(doomedNodeId);

			expect((await readNode(survivorNodeId)).headers[cacheStatusHeader])
				.toBe('HIT');

			await request(getUrl(vendor, env))
				.delete(`/items/${NODE}/${doomedNodeId}`)
				.set('Authorization', auth);

			const [survivorAfter, bystanderAfter] = await Promise.all([
				readNode(survivorNodeId),
				readNode(bystanderNodeId),
			]);

			expect(survivorAfter.headers[cacheStatusHeader]).toBe('MISS');
			expect(survivorAfter.body.data.parent).toBeNull();

			expect(bystanderAfter.headers[cacheStatusHeader]).toBe('HIT');
		});

		it(oneLine`
			deleting the parent evicts a survivor read pinned on another scope field
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const [affected, control] = await Promise.all([readOwned(1), readOwned(2)]);

			expect(affected.headers[cacheStatusHeader]).toBe('MISS');
			expect(control.headers[cacheStatusHeader]).toBe('MISS');
			expect(affected.headers[cacheTagsHeader]).toBe(`${OWNED}:owner=1`);

			expect(affected.body.data.map((row: { parent: number | null }) => row.parent))
				.toEqual([doomedOwnedId, doomedOwnedId]);

			expect((await readOwned(1)).headers[cacheStatusHeader]).toBe('HIT');

			await request(getUrl(vendor, env))
				.delete(`/items/${OWNED}/${doomedOwnedId}`)
				.set('Authorization', auth);

			const [affectedAfter, controlAfter] = await Promise.all([
				readOwned(1),
				readOwned(2),
			]);

			expect(affectedAfter.headers[cacheStatusHeader]).toBe('MISS');

			expect(affectedAfter.body.data.map((row: { parent: number | null }) => {
				return row.parent;
			})).toEqual([null, null]);

			expect(controlAfter.headers[cacheStatusHeader]).toBe('HIT');
		});

		it.runIf(supportsSetDefault)(oneLine`
			deleting the parent evicts the slice its children fall back into
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const [fallback, kept] = await Promise.all([
				readDefaulted(FALLBACK_ID),
				readDefaulted(keptDefaultedId),
			]);

			expect(fallback.headers[cacheStatusHeader]).toBe('MISS');
			expect(kept.headers[cacheStatusHeader]).toBe('MISS');

			expect(fallback.headers[cacheTagsHeader])
				.toBe(`${DEFAULTED}:parent=${FALLBACK_ID}`);

			expect(fallback.body.data).toHaveLength(1);

			expect((await readDefaulted(FALLBACK_ID)).headers[cacheStatusHeader])
				.toBe('HIT');

			await request(getUrl(vendor, env))
				.delete(`/items/${DEFAULTED}/${doomedDefaultedId}`)
				.set('Authorization', auth);

			const [fallbackAfter, keptAfter] = await Promise.all([
				readDefaulted(FALLBACK_ID),
				readDefaulted(keptDefaultedId),
			]);

			// The database moved a and b under the fallback: the slice grew.
			expect(fallbackAfter.headers[cacheStatusHeader]).toBe('MISS');
			expect(fallbackAfter.body.data).toHaveLength(3);

			expect(keptAfter.headers[cacheStatusHeader]).toBe('HIT');
		});
	});
});
