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

// A note reached by two reverse fks that disagree on its key — `discipline.notes`
// and `unit.notes` off one enrollment — is `o2mConflicted`: no parent-key pin
// names the rows either path nested. What bounds each NODE's own rows does — its
// `deep` filter is the WHERE the node runs under whichever path reached it — so
// a slice every node binds names every note the read carries. One node nothing
// bounds, one bound on a column no slice names, or more pins than the ceiling
// allows, and the note is bare; a filter reaching past the nested rows too.
const ENROLLMENT = 'ncb_enrollment';
const DISCIPLINE = 'ncb_discipline';
const UNIT = 'ncb_unit';
const NOTE = 'ncb_note';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a collection two reverse fks disagree on slices by what bounds each node's
	own rows (#518)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-o2m-conflict-node-bounds-${vendor}`;
		// Two nodes binding one slice each sit at the ceiling; one of them binding
		// an `_in` of two crosses it.
		env[vendor]['CACHE_SCOPED_MAX_PINS_PER_COLLECTION'] = '2';

		let instance: ChildProcess;
		let enrollmentId: number;
		let disciplineIds: number[];
		let unitIds: number[];
		let noteIds: number[];
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ENROLLMENT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: DISCIPLINE,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: UNIT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: NOTE,
						meta: { scoped_cache_fields: ['discipline', 'unit'] },
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: ENROLLMENT,
				field: 'discipline',
				otherCollection: DISCIPLINE,
			});

			await CreateFieldM2O(vendor, {
				collection: ENROLLMENT,
				field: 'unit',
				otherCollection: UNIT,
			});

			await CreateFieldO2M(vendor, {
				collection: DISCIPLINE,
				field: 'notes',
				otherCollection: NOTE,
				otherField: 'discipline',
			});

			await CreateFieldO2M(vendor, {
				collection: UNIT,
				field: 'notes',
				otherCollection: NOTE,
				otherField: 'unit',
			});

			const disciplines = await CreateItem(vendor, {
				collection: DISCIPLINE,
				item: [{ name: 'discipline 1' }, { name: 'discipline 2' }],
			});

			disciplineIds = disciplines.map((row: { id: number }) => row.id);

			const units = await CreateItem(vendor, {
				collection: UNIT,
				item: [{ name: 'unit 1' }, { name: 'unit 2' }],
			});

			unitIds = units.map((row: { id: number }) => row.id);

			const notes = await CreateItem(vendor, {
				collection: NOTE,
				item: [
					// Under both of the enrollment's parents: nested twice.
					{ body: 'a', discipline: disciplineIds[0], unit: unitIds[1] },
					// Under the enrollment's unit alone.
					{ body: 'b', discipline: disciplineIds[1], unit: unitIds[1] },
					// Under neither.
					{ body: 'c', discipline: disciplineIds[1], unit: unitIds[0] },
				],
			});

			noteIds = notes.map((row: { id: number }) => row.id);

			const enrollments = await CreateItem(vendor, {
				collection: ENROLLMENT,
				item: [{
					name: 'enrollment',
					discipline: disciplineIds[0],
					unit: unitIds[1],
				}],
			});

			enrollmentId = enrollments[0].id;

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

			for (const collection of [NOTE, ENROLLMENT, DISCIPLINE, UNIT]) {
				await DeleteCollection(vendor, { collection });
			}
		});

		type Bounds = {
			discipline?: Record<string, unknown>;
			unit?: Record<string, unknown>;
		};

		// The enrollment's notes through both parents, each node bounded as told.
		function readNotes(bounds: Bounds, filter: Record<string, string> = {}) {
			const deep: Record<string, unknown> = {};

			if (bounds.discipline) {
				deep['discipline'] = { notes: { _filter: bounds.discipline } };
			}

			if (bounds.unit) {
				deep['unit'] = { notes: { _filter: bounds.unit } };
			}

			return request(getUrl(vendor, env))
				.get(`/items/${ENROLLMENT}`)
				.query({
					'filter[id][_eq]': String(enrollmentId),
					fields: 'discipline.notes.body,unit.notes.body',
					deep: JSON.stringify(deep),
					...filter,
				})
				.set('Authorization', auth);
		}

		function updateNote(id: number, body: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${NOTE}/${id}`)
				.send({ body })
				.set('Authorization', auth);
		}

		function bothBounded(): Bounds {
			return {
				discipline: { discipline: { _eq: disciplineIds[0] } },
				unit: { unit: { _eq: unitIds[1] } },
			};
		}

		async function cacheStatus(): Promise<string> {
			return (await readNotes(bothBounded())).headers[cacheStatusHeader];
		}

		async function expectCached(): Promise<void> {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			expect(await cacheStatus()).toBe('MISS');
			expect(await cacheStatus()).toBe('HIT');
		}

		function expectBare(tags: string): void {
			expect(tags).toMatch(new RegExp(`(^|, )${NOTE}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${NOTE}:`));
		}

		it(oneLine`
			nested through both, each node's own filter slices the rows it
			returns, whichever fk reached them
		`, async () => {
			const response = await readNotes(bothBounded());
			const tags = response.headers[cacheTagsHeader];

			expect(response.body.data[0].discipline.notes).toEqual([{ body: 'a' }]);

			expect(response.body.data[0].unit.notes)
				.toEqual([{ body: 'a' }, { body: 'b' }]);

			expect(tags).toMatch(
				new RegExp(`(^|, )${NOTE}:discipline=${disciplineIds[0]}(,|$)`),
			);

			expect(tags).toMatch(new RegExp(`(^|, )${NOTE}:unit=${unitIds[1]}(,|$)`));
			expect(tags).not.toMatch(new RegExp(`(^|, )${NOTE}(,|$)`));
		});

		it('a write to a note under neither parent keeps the read cached', async () => {
			await expectCached();

			await updateNote(noteIds[2]!, 'c touched');

			expect(await cacheStatus()).toBe('HIT');
		});

		it('a write to a note one node returned evicts the read', async () => {
			await expectCached();

			await updateNote(noteIds[1]!, 'b touched');

			expect(await cacheStatus()).toBe('MISS');
		});

		it('a note moved into one node\'s slice evicts the read', async () => {
			await expectCached();

			await request(getUrl(vendor, env))
				.patch(`/items/${NOTE}/${noteIds[2]}`)
				.send({ unit: unitIds[1] })
				.set('Authorization', auth);

			expect(await cacheStatus()).toBe('MISS');

			await request(getUrl(vendor, env))
				.patch(`/items/${NOTE}/${noteIds[2]}`)
				.send({ unit: unitIds[0] })
				.set('Authorization', auth);
		});

		it('nested through both with a node nothing bounds, it is bare', async () => {
			const tags = (await readNotes({
				unit: { unit: { _eq: unitIds[1] } },
			})).headers[cacheTagsHeader];

			expectBare(tags);
		});

		it(oneLine`
			nested through both with a node bound on a column no slice names, it
			is bare
		`, async () => {
			const tags = (await readNotes({
				discipline: { discipline: { _eq: disciplineIds[0] } },
				unit: { body: { _eq: 'a' } },
			})).headers[cacheTagsHeader];

			expectBare(tags);
		});

		it(oneLine`
			nested through both with the nodes binding more pins than the ceiling,
			it is bare
		`, async () => {
			const tags = (await readNotes({
				discipline: { discipline: { _in: disciplineIds } },
				unit: { unit: { _eq: unitIds[1] } },
			})).headers[cacheTagsHeader];

			expectBare(tags);
		});

		it(oneLine`
			nested through both and filtered on beyond them, it is bare: the
			nodes' slices name only the rows they returned
		`, async () => {
			const tags = (await readNotes(bothBounded(), {
				'filter[discipline][notes][body][_eq]': 'a',
			})).headers[cacheTagsHeader];

			expectBare(tags);
		});
	});
});
