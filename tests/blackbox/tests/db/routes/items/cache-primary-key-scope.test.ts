import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
	CreateItem,
	DeleteCollection,
	DeleteField,
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

// End-to-end witness for the implicit primary-key axis
// (https://github.com/jclaveau/directus/issues/357): `note` declares NO
// `scoped_cache_fields`, so every slice here comes from the key alone — the shape a
// deployment gets without configuring anything.
//
// `readOne` is bounded to one key and no insert can join its result set, so only a
// write to THAT row may drop it. Read via `x-cache-status` on a scoped-purge redis:
//
//   - writing a sibling row leaves the keyed read HIT (it used to carry the bare
//     collection tag, so any write to the collection dropped it).
//   - writing the read's own row drops it → MISS.
//   - an unbounded list read is still bare, and a self-referential read embeds rows
//     the key filter never bounded, so both keep dropping on any write.

const NOTE = 'test_items_note';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	the primary key pins a keyed read on a collection with no scope config (#357)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-pk-scope-${vendor}`;

		let instance: ChildProcess;
		let readNote: number;
		let siblingNote: number;
		let thirdNote: number;

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped one spawns, so it sees the
			// collection on boot. No `scoped_cache_fields` anywhere: the key is the only
			// axis, and it takes no config to get.
			await CreateCollections(vendor, {
				collections: [
					{
						collection: NOTE,
						fields: [{ field: 'subject', type: 'string', meta: {} }],
					},
				],
			});

			// A note can answer another note, which is what makes the root collection
			// reachable twice in one read — the case the pin must refuse.
			await CreateFieldM2O(vendor, {
				collection: NOTE,
				field: 'answers',
				otherCollection: NOTE,
			});

			const notes = await CreateItem(vendor, {
				collection: NOTE,
				item: [
					{ subject: 'read' },
					{ subject: 'sibling' },
					{ subject: 'third' },
				],
			});

			[readNote, siblingNote, thirdNote] = notes.map(
				(note: { id: number }) => note.id,
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

			// The self-relation has to go first: `DELETE /collections` on a collection
			// whose M2O points at itself answers 500 ("Cannot read properties of
			// undefined (reading 'sql')") and leaves the collection behind — and
			// `DeleteCollection` never looks at the response, so the leak is silent and
			// only bites a re-run against the same database.
			await DeleteField(vendor, { collection: NOTE, field: 'answers' });
			await DeleteCollection(vendor, { collection: NOTE });
		});

		function get(path: string, query: Record<string, string> = {}) {
			return request(getUrl(vendor, env))
				.get(path)
				.query(query)
				.set('Authorization', auth);
		}

		function renameNote(key: number) {
			return request(getUrl(vendor, env))
				.patch(`/items/${NOTE}/${key}`)
				.send({ subject: `renamed-${Date.now()}` })
				.set('Authorization', auth);
		}

		// Every case starts from an empty cache, then fills the entry under test and
		// proves it IS cached before asking what drops it. Returns the tags the fill
		// pinned, so each case names the slice it depends on rather than inferring it
		// from what happens to drop.
		async function pinsOfCachedRead(
			path: string,
			query: Record<string, string> = {},
		): Promise<string | undefined> {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const miss = await get(path, query);
			const hit = await get(path, query);

			expect(miss.headers[cacheStatusHeader]).toBe('MISS');
			expect(hit.headers[cacheStatusHeader]).toBe('HIT');

			return miss.headers[cacheTagsHeader];
		}

		it(oneLine`
			a write to a sibling row leaves a keyed read cached, and a write to its own row
			drops it
		`, async () => {
			const pins = await pinsOfCachedRead(`/items/${NOTE}/${readNote}`);
			expect(pins).toBe(`${NOTE}:id=${readNote}`);

			// The sibling's own slice goes; this entry is pinned to another key.
			await renameNote(siblingNote);

			expect((await get(`/items/${NOTE}/${readNote}`)).headers[cacheStatusHeader])
				.toBe('HIT');

			await renameNote(readNote);

			expect((await get(`/items/${NOTE}/${readNote}`)).headers[cacheStatusHeader])
				.toBe('MISS');
		});

		it(oneLine`
			a delete of another row leaves a keyed read cached — the delete purges the key
			it removed, not the collection
		`, async () => {
			const [spare] = await CreateItem(vendor, {
				collection: NOTE,
				item: [{ subject: 'spare' }],
			});

			await pinsOfCachedRead(`/items/${NOTE}/${readNote}`);

			await request(getUrl(vendor, env))
				.delete(`/items/${NOTE}/${spare.id}`)
				.set('Authorization', auth);

			expect((await get(`/items/${NOTE}/${readNote}`)).headers[cacheStatusHeader])
				.toBe('HIT');
		});

		it(oneLine`
			an _in read is pinned to every key it lists — a write outside the list
			leaves it cached, one inside drops it
		`, async () => {
			const listed = { 'filter[id][_in]': `${readNote},${siblingNote}` };

			const pins = await pinsOfCachedRead(`/items/${NOTE}`, listed);

			expect(pins)
				.toBe(`${NOTE}:id=${readNote}, ${NOTE}:id=${siblingNote}`);

			await renameNote(thirdNote);

			expect((await get(`/items/${NOTE}`, listed)).headers[cacheStatusHeader])
				.toBe('HIT');

			await renameNote(siblingNote);

			expect((await get(`/items/${NOTE}`, listed)).headers[cacheStatusHeader])
				.toBe('MISS');
		});

		it(oneLine`
			an unbounded list read is not pinned — it bounds no key, so any write to the
			collection still drops it
		`, async () => {
			const pins = await pinsOfCachedRead(`/items/${NOTE}`);
			expect(pins).toBe(NOTE);

			await renameNote(siblingNote);

			expect((await get(`/items/${NOTE}`)).headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			a self-referential read is not pinned — the embedded notes carry keys the
			filter never bounded, so a write to any of them drops it
		`, async () => {
			const embedded = { fields: '*,answers.*' };

			const pins = await pinsOfCachedRead(`/items/${NOTE}/${readNote}`, embedded);
			expect(pins).toBe(NOTE);

			await renameNote(siblingNote);

			expect(
				(await get(`/items/${NOTE}/${readNote}`, embedded))
					.headers[cacheStatusHeader],
			).toBe('MISS');
		});
	});
});
