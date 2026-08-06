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

// End-to-end witness for hook CANCELLATION (return null) on UPDATE and DELETE
// against the scoped cache (#292). A create veto lives in cache-takeover-scope; this
// covers the other two mutation events, on a scoped-purge redis instance:
//
//   - a pure veto (declares nothing) purges NOTHING and leaves the row unchanged /
//     undeleted — a cancel changed nothing, so the slice stays warm.
//   - a veto that declares its slice via `purgeBy` purges precisely — pinning the
//     parity fix that drains the collector on the update/delete cancel path (before
//     the fix these early-returned and dropped the declaration).
//   - a pure veto's GLOBAL (unscoped) read stays warm too: the cancel changed
//     nothing, so not even the bare collection tag is purged (a pure cancel must
//     not drain the collector, else every rejected write flushes all global reads).

const EDITABLE = 'test_items_editable';
const REMOVABLE = 'test_items_removable';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	update/delete hook cancel: a pure veto purges nothing, a veto that declares its
	slice via purgeBy purges precisely (#292)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-cancel-write-${vendor}`;

		let instance: ChildProcess;
		let editA: number;
		let removeProtect: number;
		let removeFlag: number;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns, so it sees
			// both collections (+ their `scoped_cache_fields`) on boot. Both scoped by
			// `space`; the hooks veto by a per-row signal (update: the note patch, delete:
			// the row's mode).
			await CreateCollections(vendor, {
				collections: [
					{
						collection: EDITABLE,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string', meta: {} },
							{ field: 'note', type: 'string', meta: {} },
						],
					},
					{
						collection: REMOVABLE,
						meta: { scoped_cache_fields: ['space'] },
						fields: [
							{ field: 'space', type: 'string', meta: {} },
							{ field: 'mode', type: 'string', meta: {} },
						],
					},
				],
			});

			// Independent seeds → one round-trip. Capture the PKs the hooks act on.
			const [editables, removables] = await Promise.all([
				CreateItem(vendor, {
					collection: EDITABLE,
					item: [
						{ space: 'a', note: 'orig' },
						{ space: 'b', note: 'orig' },
					],
				}),
				CreateItem(vendor, {
					collection: REMOVABLE,
					item: [
						{ space: 'p', mode: 'protect' },
						{ space: 'q', mode: 'flag' },
					],
				}),
			]);

			editA = editables[0].id;

			[removeProtect, removeFlag] = removables.map(
				(row: { id: number }) => row.id,
			);

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
				DeleteCollection(vendor, { collection: EDITABLE }),
				DeleteCollection(vendor, { collection: REMOVABLE }),
			]);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readSlice(collection: string, space: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.query({ 'filter[space][_eq]': space })
				.set('Authorization', auth);
		}

		function readAll(collection: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${collection}`)
				.set('Authorization', auth);
		}

		it(oneLine`
			an update veto that declares nothing purges nothing — the row's slice stays
			warm and the row is unchanged
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await Promise.all([readSlice(EDITABLE, 'a'), readSlice(EDITABLE, 'b')]);

			// Patch note 'reject': the hook vetoes the update, declaring nothing.
			await request(url)
				.patch(`/items/${EDITABLE}/${editA}`)
				.send({ note: 'reject' })
				.set('Authorization', auth);

			const [a, b] = await Promise.all([
				readSlice(EDITABLE, 'a'),
				readSlice(EDITABLE, 'b'),
			]);

			expect(a.headers[cacheStatusHeader]).toBe('HIT');
			expect(b.headers[cacheStatusHeader]).toBe('HIT');
			// The veto wrote nothing — the note is still its seeded value.
			expect(a.body.data[0].note).toBe('orig');
		});

		it(oneLine`
			an update veto that declares its slice via purgeBy purges precisely — the
			declared space MISSes, a sibling AND the global read stay warm, still no write
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await Promise.all([
				readSlice(EDITABLE, 'a'),
				readSlice(EDITABLE, 'b'),
				readAll(EDITABLE),
			]);

			// Patch note 'flag': the hook declares space 'a' via purgeBy, then vetoes.
			await request(url)
				.patch(`/items/${EDITABLE}/${editA}`)
				.send({ note: 'flag' })
				.set('Authorization', auth);

			const [a, b, all] = await Promise.all([
				readSlice(EDITABLE, 'a'),
				readSlice(EDITABLE, 'b'),
				readAll(EDITABLE),
			]);

			expect(a.headers[cacheStatusHeader]).toBe('MISS');
			expect(b.headers[cacheStatusHeader]).toBe('HIT');
			// Declaring cancel drops ONLY space 'a' — the bare tag (global read) stays
			// warm, since the collection itself didn't change (#4).
			expect(all.headers[cacheStatusHeader]).toBe('HIT');
			expect(a.body.data[0].note).toBe('orig');
		});

		it(oneLine`
			a delete veto that declares nothing purges nothing — the row's slice stays warm
			and the row survives
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await Promise.all([readSlice(REMOVABLE, 'p'), readSlice(REMOVABLE, 'q')]);

			// Delete the 'protect' row: the hook vetoes the deletion, declaring nothing.
			await request(url)
				.delete(`/items/${REMOVABLE}/${removeProtect}`)
				.set('Authorization', auth);

			const [p, q] = await Promise.all([
				readSlice(REMOVABLE, 'p'),
				readSlice(REMOVABLE, 'q'),
			]);

			expect(p.headers[cacheStatusHeader]).toBe('HIT');
			expect(q.headers[cacheStatusHeader]).toBe('HIT');
			// The veto deleted nothing — the row is still there.
			expect(p.body.data).toHaveLength(1);
		});

		it(oneLine`
			a delete veto that declares its slice via purgeBy purges precisely — the
			declared space MISSes, a sibling AND the global read stay warm, row survives
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await Promise.all([
				readSlice(REMOVABLE, 'p'),
				readSlice(REMOVABLE, 'q'),
				readAll(REMOVABLE),
			]);

			// Delete the 'flag' row: the hook declares space 'q' via purgeBy, then vetoes.
			await request(url)
				.delete(`/items/${REMOVABLE}/${removeFlag}`)
				.set('Authorization', auth);

			const [p, q, all] = await Promise.all([
				readSlice(REMOVABLE, 'p'),
				readSlice(REMOVABLE, 'q'),
				readAll(REMOVABLE),
			]);

			expect(p.headers[cacheStatusHeader]).toBe('HIT');
			expect(q.headers[cacheStatusHeader]).toBe('MISS');
			// Declaring cancel drops ONLY space 'q' — the bare tag (global read) stays
			// warm, since the collection itself didn't change (#4).
			expect(all.headers[cacheStatusHeader]).toBe('HIT');
			expect(q.body.data).toHaveLength(1);
		});

		it(oneLine`
			a pure update veto leaves the collection's GLOBAL (unscoped) read warm — the
			cancel changed nothing, so the bare collection tag is left untouched
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// Warm an unscoped list read → carried by the bare collection tag.
			await readAll(EDITABLE);

			// Pure veto: the hook cancels the update without declaring any purge.
			await request(url)
				.patch(`/items/${EDITABLE}/${editA}`)
				.send({ note: 'reject' })
				.set('Authorization', auth);

			const all = await readAll(EDITABLE);

			expect(all.headers[cacheStatusHeader]).toBe('HIT');
		});

		it(oneLine`
			a pure delete veto leaves the collection's GLOBAL (unscoped) read warm — the
			cancel deleted nothing, so the bare collection tag is left untouched
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			await readAll(REMOVABLE);

			// Pure veto: the hook cancels the deletion without declaring any purge.
			await request(url)
				.delete(`/items/${REMOVABLE}/${removeProtect}`)
				.set('Authorization', auth);

			const all = await readAll(REMOVABLE);

			expect(all.headers[cacheStatusHeader]).toBe('HIT');
		});
	});
});
