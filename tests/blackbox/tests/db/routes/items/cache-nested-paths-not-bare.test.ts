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

// The planner's review-round read, reduced to the shapes that fell bare after
// #438 while #402 had pinned every one of them:
//
// - an o2m aliased twice with a `deep` sort and `_limit: 1` (`start`/`end` over
//   `days`), where the child's parent-fk slice covers every row of the parent;
// - a to-many node sorted through to-one hops (`part.course.sort`) it also
//   projects, so the rows the sort depends on are the nested rows themselves;
// - a collection reached by an m2o (`time_slots.part`) and by the o2m hanging
//   off that very row's own parent (`part.course.parts`), where the o2m's
//   parent-key slice names every m2o-reached row too;
// - the ownership ancestors of a root filtered on one of them, under the
//   per-collection permission cases of a non-admin.
const OWNER = 'npb_owner';
const TU = 'npb_tu';
const RR = 'npb_rr';
const DAY = 'npb_day';
const CFG = 'npb_cfg';
const MR = 'npb_mr';
const TS = 'npb_ts';
const PART = 'npb_part';
const COURSE = 'npb_course';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a read's nested paths keep their pins where the nested rows bound them
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-nested-paths-not-bare-${vendor}`;

		let instance: ChildProcess;
		let tuId: number;
		let rrId: number;
		let mrId: number;
		let courseIds: number[];
		const userToken = `npb-${vendor}-00000000000000000000000000`;
		const admin = `Bearer ${USER.ADMIN.TOKEN}`;
		const asUser = `Bearer ${userToken}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: OWNER,
						fields: [{ field: 'user', type: 'string', meta: {} }],
					},
					{
						collection: TU,
						meta: { scoped_cache_fields: ['owner.user'] },
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: RR,
						meta: { scoped_cache_fields: ['tu', 'tu.owner.user'] },
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: DAY,
						meta: { scoped_cache_fields: ['rr'] },
						fields: [{ field: 'date', type: 'string', meta: {} }],
					},
					{
						collection: CFG,
						meta: { scoped_cache_fields: ['item'] },
						fields: [
							{ field: 'collection', type: 'string', meta: {} },
							{ field: 'item', type: 'integer', meta: {} },
						],
					},
					{
						collection: MR,
						meta: { scoped_cache_fields: ['tu', 'user_created'] },
						fields: [{ field: 'user_created', type: 'string', meta: {} }],
					},
					{
						collection: TS,
						meta: { scoped_cache_fields: ['part'] },
						fields: [{ field: 'note', type: 'string', meta: {} }],
					},
					{
						collection: PART,
						meta: { scoped_cache_fields: ['course'] },
						fields: [
							{ field: 'name', type: 'string', meta: {} },
							{ field: 'sort', type: 'integer', meta: {} },
						],
					},
					{
						collection: COURSE,
						meta: { scoped_cache_fields: ['tu'] },
						fields: [
							{ field: 'name', type: 'string', meta: {} },
							{ field: 'sort', type: 'integer', meta: {} },
						],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: TU,
				field: 'owner',
				otherCollection: OWNER,
			});

			await CreateFieldM2O(vendor, {
				collection: RR,
				field: 'tu',
				otherCollection: TU,
			});

			await CreateFieldO2M(vendor, {
				collection: RR,
				field: 'days',
				otherCollection: DAY,
				otherField: 'rr',
			});

			await CreateFieldM2O(vendor, {
				collection: CFG,
				field: 'mr',
				otherCollection: MR,
			});

			await CreateFieldM2O(vendor, {
				collection: MR,
				field: 'tu',
				otherCollection: TU,
			});

			await CreateFieldO2M(vendor, {
				collection: MR,
				field: 'time_slots',
				otherCollection: TS,
				otherField: 'mr',
			});

			await CreateFieldM2O(vendor, {
				collection: TS,
				field: 'part',
				otherCollection: PART,
			});

			await CreateFieldM2O(vendor, {
				collection: COURSE,
				field: 'tu',
				otherCollection: TU,
			});

			await CreateFieldO2M(vendor, {
				collection: COURSE,
				field: 'parts',
				otherCollection: PART,
				otherField: 'course',
			});

			const userResponse = await request(getUrl(vendor, env))
				.post('/users')
				.set('Authorization', admin)
				.send({
					first_name: 'nested paths user',
					token: userToken,
					policies: {
						create: [{
							policy: {
								name: 'nested paths policy',
								app_access: true,
								permissions: {
									// A per-row filter on every collection, so each node reads
									// under a case the way the planner's ownership policies do.
									create: [OWNER, TU, RR, DAY, CFG, MR, TS, PART, COURSE].map(
										(collection) => {
											return {
												policy: '+',
												permissions: { id: { _nnull: true } },
												validation: null,
												fields: ['*'],
												presets: null,
												collection,
												action: 'read',
											};
										},
									),
									update: [],
									delete: [],
								},
							},
						}],
						update: [],
						delete: [],
					},
				});

			if (!userResponse.ok) {
				throw new Error(
					`Could not create user: ${JSON.stringify(userResponse.body)}`,
				);
			}

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ user: 'u1' }],
			});

			const tus = await CreateItem(vendor, {
				collection: TU,
				item: [{ name: 'UE 1', owner: owners[0].id }],
			});

			tuId = tus[0].id;

			const rrs = await CreateItem(vendor, {
				collection: RR,
				item: [{ name: 'round', tu: tuId }],
			});

			rrId = rrs[0].id;

			await CreateItem(vendor, {
				collection: DAY,
				item: [
					{ date: '2023-11-17', rr: rrId },
					{ date: '2023-11-19', rr: rrId },
				],
			});

			const mrs = await CreateItem(vendor, {
				collection: MR,
				item: [{ tu: tuId, user_created: 'u1' }],
			});

			mrId = mrs[0].id;

			await CreateItem(vendor, {
				collection: CFG,
				item: [{ collection: RR, item: rrId, mr: mrId }],
			});

			const courses = await CreateItem(vendor, {
				collection: COURSE,
				item: [1, 2, 3].map((sort) => {
					return { name: `Course 1-${sort}`, sort, tu: tuId };
				}),
			});

			courseIds = courses.map((course: { id: number }) => course.id);

			const parts = await CreateItem(vendor, {
				collection: PART,
				item: courseIds.map((course) => ({ name: 'Partie 1', sort: 1, course })),
			});

			await CreateItem(vendor, {
				collection: TS,
				item: parts.map((part: { id: number }) => ({ mr: mrId, part: part.id })),
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
			instance?.kill();

			for (const collection of [TS, PART, COURSE, CFG, MR, DAY, RR, TU, OWNER]) {
				await DeleteCollection(vendor, { collection });
			}
		});

		async function tagsOf(
			name: string,
			path: string,
			query: Record<string, string>,
			authorization: string,
		): Promise<string> {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', admin);

			const response = await request(getUrl(vendor, env))
				.get(path)
				.query(query)
				.set('Authorization', authorization);

			expect(response.status, name).toBe(200);
			expect(response.body.data.length, `${name}: rows`).toBeGreaterThan(0);

			return response.headers[cacheTagsHeader];
		}

		// The whole list, sorted, in the failure message: what a red case pinned.
		function whatItPinned(tags: string): string {
			return tags
				.split(', ')
				.sort()
				.join(', ');
		}

		function expectNotBare(tags: string, collection: string, name: string) {
			expect(tags, `${name}: ${collection} bare — ${whatItPinned(tags)}`)
				.not.toMatch(new RegExp(`(^|, )${collection}(,|$)`));
		}

		function expectSlice(tags: string, slice: string, name: string) {
			expect(tags, `${name}: ${slice} missing — ${whatItPinned(tags)}`)
				.toMatch(new RegExp(`(^|, )${slice}(,|$)`));
		}

		const roundReadQueries = {
			'days only': {
				fields: 'id,tu,days.date',
				deep: JSON.stringify({ days: { _sort: 'date' } }),
			},
			'aliases under a limit': {
				fields: 'id,tu,days.date,start.date,end.date',
				'alias[start]': 'days',
				'alias[end]': 'days',
				deep: JSON.stringify({
					days: { _sort: 'date' },
					start: { _sort: 'date', _limit: 1 },
					end: { _sort: '-date', _limit: 1 },
				}),
			},
			'aliases without a limit': {
				fields: 'id,tu,days.date,start.date,end.date',
				'alias[start]': 'days',
				'alias[end]': 'days',
				deep: JSON.stringify({
					days: { _sort: 'date' },
					start: { _sort: 'date' },
					end: { _sort: '-date' },
				}),
			},
		};

		describe.each([
			['as admin', () => admin],
			['as the owner', () => asUser],
		])('%s', (who, authorization) => {
			it.each(Object.entries(roundReadQueries))(oneLine`
				pins the days of a round read by its teaching unit: %s
			`, async (shape, query) => {
				const name = `round ${shape} ${who}`;

				const tags = await tagsOf(name, `/items/${RR}`, {
					...query,
					'filter[tu][id][_eq]': String(tuId),
				}, authorization());

				expectSlice(tags, `${DAY}:rr=${rrId}`, name);
				expectNotBare(tags, DAY, name);
				expectNotBare(tags, TU, name);
				expectNotBare(tags, OWNER, name);
			});

			const cfgFields = [
				'item',
				'mr.id',
				'mr.user_created',
				'mr.time_slots.*',
				'mr.time_slots.part.*',
				'mr.time_slots.part.course.*',
			];

			const withParts = [...cfgFields, 'mr.time_slots.part.course.parts.*'];

			const sortedThroughCourse = JSON.stringify({
				mr: { time_slots: { _sort: ['part.course.sort', 'part.sort', 'id'] } },
			});

			it.each([
				['unsorted, no parts', cfgFields, undefined],
				['sorted by id, no parts', cfgFields, JSON.stringify({
					mr: { time_slots: { _sort: ['id'] } },
				})],
				['sorted through the course, no parts', cfgFields, sortedThroughCourse],
				['unsorted, with parts', withParts, undefined],
				['sorted through the course, with parts', withParts, sortedThroughCourse],
			])(oneLine`
				pins the time slots, parts and courses a configuration read nests: %s
			`, async (shape, fields, deep) => {
				const name = `configuration ${shape} ${who}`;

				const query: Record<string, string> = {
					fields: fields.join(','),
					'filter[collection][_eq]': RR,
					'filter[item][_in]': String(rrId),
				};

				if (deep !== undefined) {
					query['deep'] = deep;
				}

				const tags = await tagsOf(name, `/items/${CFG}`, query, authorization());

				expectSlice(tags, `${CFG}:item=${rrId}`, name);

				for (const collection of [MR, TS, PART, COURSE, TU]) {
					expectNotBare(tags, collection, name);
				}

				for (const course of courseIds) {
					expectSlice(tags, `${COURSE}:id=${course}`, name);
				}
			});
		});
	});
});
