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

// RED until fixed. A note reached by two disagreeing O2M reverse fks is
// `o2mConflicted` (should be bare), yet is also KEYED by filter and never nested, so
// it skips the nested-bare branch (~759) for the union branch (~781) — which emits
// its keyed slice `note:id=<pinnedNote>` and no bare tag. The fix forces bare on
// `o2mConflicted` first (~731). Filters, not nesting: a nested conflicted note can't
// reach the union branch, since `pinnedScopedCacheTagsFromM2oParents` drops any
// collection carrying an o2m-terminal path, so it is never m2o-pinned.
const ENROLLMENT = 'o2m_m2o_enrollment';
const NOTE = 'o2m_m2o_note';
const DISCIPLINE = 'o2m_m2o_discipline';
const TEACHING_UNIT = 'o2m_m2o_teaching_unit';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	an o2m-conflicted collection also reached by an m2o is tagged only by the m2o
	slice, so a write to a reverse-fk-nested row serves stale (#402)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-o2m-conflict-m2o-${vendor}`;

		let instance: ChildProcess;
		let enrollmentId: number;
		let disciplineId: number;
		let teachingUnitId: number;
		let pinnedNoteId: number;
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
						collection: TEACHING_UNIT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: NOTE,
						// Both reverse fks declared, so each O2M path clears the "the write
						// side emits this shallow tag" gate on its own and the refusal is
						// about the disagreement, not the gate (read-tags.ts ~645-651).
						meta: {
							scoped_cache_fields: ['discipline_id', 'teaching_unit_id'],
						},
						fields: [{ field: 'body', type: 'string', meta: {} }],
					},
				],
			});

			// The genuine m2o `pinned_note`; filtered by pk it joins the read beside
			// the two o2m paths, and note's keyed `note:id` pin unions across all three.
			await CreateFieldM2O(vendor, {
				collection: ENROLLMENT,
				field: 'pinned_note',
				otherCollection: NOTE,
			});

			// The two disagreeing reverse fks: `discipline.notes` keys the note on
			// `discipline_id`, `teaching_unit.notes` on `teaching_unit_id`.
			await CreateFieldO2M(vendor, {
				collection: DISCIPLINE,
				field: 'notes',
				otherCollection: NOTE,
				otherField: 'discipline_id',
			});

			await CreateFieldO2M(vendor, {
				collection: TEACHING_UNIT,
				field: 'notes',
				otherCollection: NOTE,
				otherField: 'teaching_unit_id',
			});

			// Reached from the root by an M2O each, so the filter can cross
			// `discipline.notes` and `teaching_unit.notes` — the two conflicting fks.
			await CreateFieldM2O(vendor, {
				collection: ENROLLMENT,
				field: 'discipline',
				otherCollection: DISCIPLINE,
			});

			await CreateFieldM2O(vendor, {
				collection: ENROLLMENT,
				field: 'teaching_unit',
				otherCollection: TEACHING_UNIT,
			});

			const disciplines = await CreateItem(vendor, {
				collection: DISCIPLINE,
				item: [{ name: 'a discipline' }],
			});

			disciplineId = disciplines[0].id;

			const teachingUnits = await CreateItem(vendor, {
				collection: TEACHING_UNIT,
				item: [{ name: 'a teaching unit' }],
			});

			teachingUnitId = teachingUnits[0].id;

			// One note the read reaches three ways: the m2o `pinned_note` and both o2m
			// reverse fks, so it is keyed by pk while the two fks disagree → conflicted.
			const notes = await CreateItem(vendor, {
				collection: NOTE,
				item: [{
					body: 'pinned note',
					discipline_id: disciplineId,
					teaching_unit_id: teachingUnitId,
				}],
			});

			pinnedNoteId = notes[0].id;

			const enrollments = await CreateItem(vendor, {
				collection: ENROLLMENT,
				item: [
					{
						name: 'an enrollment',
						pinned_note: pinnedNoteId,
						discipline: disciplineId,
						teaching_unit: teachingUnitId,
					},
				],
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
			instance?.kill();

			await DeleteCollection(vendor, { collection: ENROLLMENT });
			await DeleteCollection(vendor, { collection: NOTE });
			await DeleteCollection(vendor, { collection: DISCIPLINE });
			await DeleteCollection(vendor, { collection: TEACHING_UNIT });
		});

		// The note is reached ONLY through filters — keyed by pk via the m2o and both
		// o2m reverse fks — never nested, so it pins by pk yet the o2m paths conflict.
		function readEnrollment() {
			return request(getUrl(vendor, env))
				.get(`/items/${ENROLLMENT}`)
				.query({
					filter: JSON.stringify({
						_and: [
							{ pinned_note: { id: { _eq: pinnedNoteId } } },
							{ discipline: { notes: { id: { _eq: pinnedNoteId } } } },
							{ teaching_unit: { notes: { id: { _eq: pinnedNoteId } } } },
						],
					}),
					fields: 'id',
				})
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			tags a conflicted, keyed note only by its pk slice, missing the bare tag
			a reverse-fk write needs
		`, async () => {
			await clearCache();

			const warm = await readEnrollment();
			expect(warm.status).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			// Non-vacuity: the filter really matched the enrollment.
			expect(warm.body.data[0].id).toBe(enrollmentId);

			// PRIMARY (RED on buggy): the fix forces the bare `note` tag; buggy
			// carries only `note:id=<pinnedNoteId>` a reverse-fk write can't purge.
			expect(warm.headers[cacheTagsHeader])
				.toMatch(new RegExp(`(^|, )${NOTE}(,|$)`));

			expect((await readEnrollment()).headers[cacheStatusHeader]).toBe('HIT');

			await request(getUrl(vendor, env))
				.patch(`/items/${NOTE}/${pinnedNoteId}`)
				.send({ body: 'rewritten' })
				.set('Authorization', auth);

			// Secondary: the note's own pk slice purges this read on the fix.
			expect((await readEnrollment()).headers[cacheStatusHeader]).toBe('MISS');
		});
	});
});
