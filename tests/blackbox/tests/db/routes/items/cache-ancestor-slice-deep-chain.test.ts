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

// A deep M2O ownership chain (unit -> discipline -> student -> owner) nested under
// the range's o2m, read with a filter keying the owner. The M2O ancestors beyond the
// o2m carry no key pin of their own, so they would bare; each instead slices to the
// keyed owner through its ownership chain — the review-round pivot shape.
const OWNER = 'dc_owner';
const STUDENT = 'dc_student';
const DISCIPLINE = 'dc_discipline';
const UNIT = 'dc_unit';
const COURSE = 'dc_course';
const PART = 'dc_part';
const SLOT = 'dc_slot';
const RANGE = 'dc_range';
const CONFIG = 'dc_config';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	the M2O ancestors beyond an o2m slice by the keyed owner, never bare (#426)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-ancestor-slice-deep-chain-${vendor}`;

		let instance: ChildProcess;
		let ownedOwnerId: number;
		let ownedUnitId: number;
		let siblingUnitId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		const scoped = (collection: string, scopeField: string) => {
			return {
				collection,
				meta: { scoped_cache_fields: [scopeField] },
				fields: [{ field: 'name', type: 'string', meta: {} }],
			};
		};

		const plain = (collection: string) => {
			return {
				collection,
				fields: [{ field: 'name', type: 'string', meta: {} }],
			};
		};

		const m2o = (collection: string, field: string, otherCollection: string) => {
			return CreateFieldM2O(vendor, { collection, field, otherCollection });
		};

		const one = async (collection: string, item: Record<string, unknown>) => {
			return await CreateItem(vendor, { collection, item });
		};

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					plain(OWNER),
					scoped(STUDENT, 'owner'),
					scoped(DISCIPLINE, 'student'),
					scoped(UNIT, 'discipline'),
					scoped(COURSE, 'unit'),
					scoped(PART, 'course'),
					scoped(SLOT, 'part'),
					plain(RANGE),
					plain(CONFIG),
				],
			});

			await m2o(STUDENT, 'owner', OWNER);
			await m2o(DISCIPLINE, 'student', STUDENT);
			await m2o(UNIT, 'discipline', DISCIPLINE);
			await m2o(COURSE, 'unit', UNIT);
			await m2o(PART, 'course', COURSE);
			await m2o(SLOT, 'part', PART);

			await CreateFieldO2M(vendor, {
				collection: RANGE,
				field: 'slots',
				otherCollection: SLOT,
				otherField: 'range',
			});

			await m2o(CONFIG, 'range', RANGE);

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ name: 'owned' }, { name: 'sibling' }],
			});

			ownedOwnerId = owners[0].id;

			const chain = async (ownerId: number) => {
				const s = await one(STUDENT, { name: 's', owner: ownerId });
				const d = await one(DISCIPLINE, { name: 'd', student: s.id });
				const u = await one(UNIT, { name: 'u', discipline: d.id });
				const co = await one(COURSE, { name: 'c', unit: u.id });
				const p = await one(PART, { name: 'p', course: co.id });
				return { unitId: u.id as number, partId: p.id as number };
			};

			const owned = await chain(ownedOwnerId);
			const sibling = await chain(owners[1].id);
			ownedUnitId = owned.unitId;
			siblingUnitId = sibling.unitId;

			const range = await one(RANGE, { name: 'r' });
			await one(SLOT, { name: 'sl', part: owned.partId, range: range.id });
			await one(CONFIG, { name: 'cfg', range: range.id });

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

			for (const collection of [
				CONFIG, RANGE, SLOT, PART, COURSE, UNIT, DISCIPLINE, STUDENT, OWNER,
			]) {
				await DeleteCollection(vendor, { collection });
			}
		});

		const ownerPath = [
			'range', 'slots', 'part', 'course', 'unit', 'discipline', 'student', 'owner',
		];

		function readConfig() {
			const ownerKey = `filter[${ownerPath.join('][')}][_eq]`;

			return request(getUrl(vendor, env))
				.get(`/items/${CONFIG}`)
				.query({
					fields: '*,range.slots.part.course.unit.discipline.student.name',
					[ownerKey]: String(ownedOwnerId),
				})
				.set('Authorization', auth);
		}

		function updateUnit(id: number, name: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${UNIT}/${id}`)
				.send({ name })
				.set('Authorization', auth);
		}

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it('slices a beyond ancestor by its ownership chain', async () => {
			const res = await readConfig();

			if (!res.headers[cacheTagsHeader]) {
				// eslint-disable-next-line no-console
				console.warn(
					`DEEPCHAIN_DIAG status=${res.status} `
						+ `body=${JSON.stringify(res.body).slice(0, 600)} `
						+ `tagsHdr=${res.headers[cacheTagsHeader]} `
						+ `ownedOwnerId=${ownedOwnerId}`,
				);
			}

			const tags = res.headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(
				`(^|, )${UNIT}:discipline.student.owner=${ownedOwnerId}(,|$)`,
			));

			expect(tags).not.toMatch(new RegExp(`(^|, )${UNIT}(,|$)`));
		});

		it('a write to an ancestor in the owner slice evicts the read', async () => {
			await clearCache();

			expect((await readConfig()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readConfig()).headers[cacheStatusHeader]).toBe('HIT');

			await updateUnit(ownedUnitId, 'owned-touched');

			expect((await readConfig()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it('a write in another owner slice keeps the read cached', async () => {
			await clearCache();

			expect((await readConfig()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readConfig()).headers[cacheStatusHeader]).toBe('HIT');

			await updateUnit(siblingUnitId, 'sibling-touched');

			expect((await readConfig()).headers[cacheStatusHeader]).toBe('HIT');
		});
	});
});
