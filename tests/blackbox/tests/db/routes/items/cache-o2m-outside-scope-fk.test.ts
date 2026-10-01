import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
	CreateFieldO2M,
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

// A note is scoped on `student` but the owner read nests it through
// `reviewed_notes`, the O2M over its `reviewer` fk. The root's key bounds the
// reviewer column, not the student one, so stamping `note:student=<root>` names a
// slice no write to the nested row reproduces.
const OWNER = 'outside_owner';
const NOTE = 'outside_note';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a to-many reached over a foreign key outside its scope stays bare
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-o2m-outside-scope-fk-${vendor}`;

		let instance: ChildProcess;
		let reviewerId: number;
		let noteId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: OWNER,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: NOTE,
						meta: { scoped_cache_fields: ['student'] },
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: NOTE,
				field: 'student',
				otherCollection: OWNER,
			});

			await CreateFieldO2M(vendor, {
				collection: OWNER,
				field: 'reviewed_notes',
				otherCollection: NOTE,
				otherField: 'reviewer',
			});

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ name: 'reviewer' }, { name: 'student' }],
			});

			reviewerId = owners[0].id;

			const notes = await CreateItem(vendor, {
				collection: NOTE,
				item: [{ body: 'draft', student: owners[1].id, reviewer: reviewerId }],
			});

			noteId = notes[0].id;

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

			await DeleteCollection(vendor, { collection: NOTE });
			await DeleteCollection(vendor, { collection: OWNER });
		});

		function readReviewer() {
			return request(getUrl(vendor, env))
				.get(`/items/${OWNER}/${reviewerId}`)
				.query({ fields: 'name,reviewed_notes.body' })
				.set('Authorization', auth);
		}

		function updateNote(body: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${NOTE}/${noteId}`)
				.send({ body })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			does not stamp the root key onto the scope field the path never walked
		`, async () => {
			const tags = (await readReviewer()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${NOTE}(,|$)`));

			expect(tags).not.toMatch(
				new RegExp(`(^|, )${NOTE}:student=${reviewerId}(,|$)`),
			);
		});

		it('a write to the reviewed note evicts the read', async () => {
			await clearCache();

			expect((await readReviewer()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readReviewer()).headers[cacheStatusHeader]).toBe('HIT');

			await updateNote('reviewed');

			const after = await readReviewer();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data.reviewed_notes[0].body).toBe('reviewed');
		});
	});
});
