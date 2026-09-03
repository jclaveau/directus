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

// RED until fixed: the `o2mConflicted` guard is consulted ONLY inside
// `pushAncestorSliceOrBare` (item-scoped-cache-service.ts ~665), reached ONLY when
// a nested collection has no m2o/o2m/keyed pin (~705-716). A collection reached in
// one read BOTH by two disagreeing O2M reverse fks (conflicted → should be bare)
// AND by a genuine M2O elsewhere (so `m2oParentPins.has(coll)` is true) skips that
// branch and takes the union branch (~721-736), which never checks o2mConflicted.
// The rows nested via the two conflicting reverse fks then go UNTAGGED: the read
// carries only the M2O slice (`note:id=<pinnedNote>`), a write to a note reached by
// a reverse fk emits a tag that never matches it, and the stale read stays a HIT.
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
		let conflictNoteId: number;
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

			// The genuine m2o path that makes `m2oParentPins.has(note)` true, pinning
			// `note:id=<pinnedNote>` and steering the note into the union branch.
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

			// Both reached from the root by an M2O, so the O2M under each nests off a
			// single surfaced parent row the pinner can descend.
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

			// N_pin is only the m2o `pinned_note`; N_c is only reachable via
			// `discipline.notes` (its `discipline_id`), a different id, never the pinned
			// one — the row the conflicting reverse fk nests and the write later touches.
			const notes = await CreateItem(vendor, {
				collection: NOTE,
				item: [
					{ body: 'pinned note' },
					{ body: 'conflict note', discipline_id: disciplineId },
				],
			});

			pinnedNoteId = notes[0].id;
			conflictNoteId = notes[1].id;

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
			instance.kill();

			await DeleteCollection(vendor, { collection: ENROLLMENT });
			await DeleteCollection(vendor, { collection: NOTE });
			await DeleteCollection(vendor, { collection: DISCIPLINE });
			await DeleteCollection(vendor, { collection: TEACHING_UNIT });
		});

		// One read reaches the note three ways: the `pinned_note` M2O, the
		// `discipline.notes` O2M (reverse fk `discipline_id`) and the
		// `teaching_unit.notes` O2M (reverse fk `teaching_unit_id`).
		function readEnrollment() {
			return request(getUrl(vendor, env))
				.get(`/items/${ENROLLMENT}`)
				.query({
					'filter[id][_eq]': String(enrollmentId),
					fields: oneLine`
						id,pinned_note.id,discipline.notes.id,discipline.notes.body,
						teaching_unit.notes.id
					`.replace(/\s+/g, ''),
				})
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			serves a stale HIT after a write to a note nested only through a
			conflicting reverse fk
		`, async () => {
			await clearCache();

			const warm = await readEnrollment();
			expect(warm.status).toBe(200);
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');

			// Non-vacuity: the conflict note really is nested with its old body.
			expect(warm.body.data[0].discipline.notes[0].id).toBe(conflictNoteId);
			expect(warm.body.data[0].discipline.notes[0].body).toBe('conflict note');

			expect((await readEnrollment()).headers[cacheStatusHeader]).toBe('HIT');

			await request(getUrl(vendor, env))
				.patch(`/items/${NOTE}/${conflictNoteId}`)
				.send({ body: 'conflict note rewritten' })
				.set('Authorization', auth);

			// HARD RED: tagged only `note:id=<pinnedNote>`, so the write to N_c never
			// purges it and the re-read serves the pre-write body.
			const after = await readEnrollment();
			expect(after.body.data[0].discipline.notes[0].body)
				.toBe('conflict note rewritten');
		});

		it(oneLine`
			carries a tag that a write to the reverse-fk-nested note would catch
		`, async () => {
			// The conflicted note should be left bare, or at least carry the slice a
			// write to N_c emits; currently only the m2o slice `note:id=N_pin` → RED.
			const tags = (await readEnrollment()).headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(
				`(^|, )${NOTE}(,|$)|(^|, )${NOTE}:id=${conflictNoteId}(,|$)`,
			));
		});
	});
});
