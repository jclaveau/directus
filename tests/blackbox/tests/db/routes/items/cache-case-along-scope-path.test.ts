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

// The planner's ownership policies, reduced: every collection is scoped by the
// foreign key toward its owner, and every read policy filters on the composed
// path from that key to the user. A nested node's case then hops OUT of the
// node along a scope path of its collection — `course.tu.owner.user` off a
// part — and each collection the hop crosses is bounded by the slice that
// path names, which the write side emits for every row whose chain lands on
// the value. Nothing on the way is bare, and a row moved into or out of the
// case, at any hop, still purges the read.
const OWNER = 'csp_owner';
const TU = 'csp_tu';
const COURSE = 'csp_course';
const PART = 'csp_part';
const TS = 'csp_ts';
const MR = 'csp_mr';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a nested node's case hopping out along a scope path slices what it crosses
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-case-along-scope-path-${vendor}`;
		// The suite default is 5; the range read nests four hops and the cases
		// walk three more.
		env[vendor]['MAX_RELATIONAL_DEPTH'] = '15';

		let instance: ChildProcess;
		let userId: string;
		let ownerId: number;
		let tuId: number;
		let strangerTuId: number;
		let strangerOwnerId: number;
		let mrId: number;
		let courseIds: number[];
		let strangerCourseId: number;
		let strangerPartId: number;
		const userToken = `csp-${vendor}-00000000000000000000000000`;
		const admin = `Bearer ${USER.ADMIN.TOKEN}`;
		const asUser = `Bearer ${userToken}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: OWNER,
						meta: { scoped_cache_fields: ['user'] },
						fields: [
							{ field: 'user', type: 'string', meta: {} },
							{ field: 'since', type: 'dateTime', meta: {} },
						],
					},
					{
						collection: TU,
						// `owner.since` is declared so a read can pin by it: a date is
						// no slice, which is what its arm below witnesses.
						meta: { scoped_cache_fields: ['owner', 'owner.since'] },
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: COURSE,
						meta: { scoped_cache_fields: ['tu'] },
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: PART,
						meta: { scoped_cache_fields: ['course'] },
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: TS,
						meta: { scoped_cache_fields: ['mr', 'part'] },
						fields: [{ field: 'note', type: 'string', meta: {} }],
					},
					{
						collection: MR,
						meta: { scoped_cache_fields: ['tu'] },
						fields: [{ field: 'method', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: TU,
				field: 'owner',
				otherCollection: OWNER,
			});

			await CreateFieldM2O(vendor, {
				collection: COURSE,
				field: 'tu',
				otherCollection: TU,
			});

			await CreateFieldM2O(vendor, {
				collection: PART,
				field: 'course',
				otherCollection: COURSE,
			});

			await CreateFieldM2O(vendor, {
				collection: TS,
				field: 'part',
				otherCollection: PART,
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

			const toUser = { user: { _eq: '$CURRENT_USER' } };

			const userResponse = await request(getUrl(vendor, env))
				.post('/users')
				.set('Authorization', admin)
				.send({
					first_name: 'case along scope path user',
					token: userToken,
					policies: {
						create: [{
							policy: {
								name: 'case along scope path policy',
								app_access: true,
								permissions: {
									create: Object.entries({
										[OWNER]: toUser,
										[TU]: { owner: toUser },
										[COURSE]: { tu: { owner: toUser } },
										[PART]: { course: { tu: { owner: toUser } } },
										// Off the range, not the part: a slot whose part is withheld
										// stays visible as a null slot.
										[TS]: { mr: { tu: { owner: toUser } } },
										[MR]: { tu: { owner: toUser } },
									}).map(([collection, permissions]) => {
										return {
											policy: '+',
											permissions: { _and: [permissions] },
											validation: null,
											fields: ['*'],
											presets: null,
											collection,
											action: 'read',
										};
									}),
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

			userId = userResponse.body.data.id;

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [
					{ user: userId, since: '2026-01-01T00:00:00' },
					{ user: 'someone-else', since: '2026-02-01T00:00:00' },
				],
			});

			ownerId = owners[0].id;
			strangerOwnerId = owners[1].id;

			const tus = await CreateItem(vendor, {
				collection: TU,
				item: [
					{ name: 'UE 1', owner: ownerId },
					{ name: 'UE stranger', owner: strangerOwnerId },
				],
			});

			tuId = tus[0].id;
			strangerTuId = tus[1].id;

			const mrs = await CreateItem(vendor, {
				collection: MR,
				item: [{ method: 'spaced', tu: tuId }],
			});

			mrId = mrs[0].id;

			const courses = await CreateItem(vendor, {
				collection: COURSE,
				item: [
					{ name: 'Course 1', tu: tuId },
					{ name: 'Course 2', tu: tuId },
					{ name: 'Course stranger', tu: strangerTuId },
				],
			});

			courseIds = courses.slice(0, 2).map((course: { id: number }) => course.id);
			strangerCourseId = courses[2].id;

			const parts = await CreateItem(vendor, {
				collection: PART,
				item: [
					{ name: 'Partie 1', course: courseIds[0] },
					{ name: 'Partie 2', course: courseIds[1] },
					// Hangs off the stranger's course: withheld from the user, its
					// slot shows it as a null slot.
					{ name: 'Partie stranger', course: strangerCourseId },
				],
			});

			strangerPartId = parts[2].id;

			await CreateItem(vendor, {
				collection: TS,
				item: parts.map((part: { id: number }, at: number) => {
					return { mr: mrId, part: part.id, note: `slot ${at + 1}` };
				}),
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

			for (const collection of [TS, PART, COURSE, MR, TU, OWNER]) {
				await DeleteCollection(vendor, { collection });
			}
		});

		const readRange = () => {
			return request(getUrl(vendor, env))
				.get(`/items/${MR}`)
				.query({
					fields: [
						'id',
						'method',
						'time_slots.note',
						'time_slots.part.name',
						'time_slots.part.course.name',
					].join(','),
					deep: JSON.stringify({ time_slots: { _sort: 'note' } }),
				})
				.set('Authorization', asUser);
		};

		const partNamesOf = (response: request.Response): (string | null)[] => {
			return response.body.data[0].time_slots.map(
				(slot: { part: { name: string } | null }) => slot.part?.name ?? null,
			);
		};

		const courseNamesOf = (response: request.Response): (string | null)[] => {
			return response.body.data[0].time_slots.map(
				(slot: { part: { course: { name: string } | null } | null }) => {
					return slot.part?.course?.name ?? null;
				},
			);
		};

		async function expectCached(
			read: () => request.Test,
		): Promise<request.Response> {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', admin);

			const missed = await read();

			expect(missed.status).toBe(200);
			expect(missed.headers[cacheStatusHeader]).toBe('MISS');
			expect((await read()).headers[cacheStatusHeader]).toBe('HIT');

			return missed;
		}

		function whatItPinned(tags: string): string {
			return tags
				.split(', ')
				.sort()
				.join(', ');
		}

		function expectSlice(tags: string, slice: string): void {
			expect(tags, `${slice} missing — ${whatItPinned(tags)}`)
				.toMatch(new RegExp(`(^|, )${slice}(,|$)`));
		}

		it(oneLine`
			slices every collection the cases hop through by the path to the user,
			the withheld parent's null slot included
		`, async () => {
			const missed = await expectCached(readRange);

			expect(partNamesOf(missed)).toEqual(['Partie 1', 'Partie 2', null]);

			const tags = missed.headers[cacheTagsHeader];

			for (const collection of [OWNER, TU, COURSE, PART, TS, MR]) {
				expect(tags, `${collection} bare — ${whatItPinned(tags)}`)
					.not.toMatch(new RegExp(`(^|, )${collection}(,|$)`));
			}

			expectSlice(tags, `${OWNER}:user=${userId}`);
			expectSlice(tags, `${TU}:owner.user=${userId}`);
			expectSlice(tags, `${COURSE}:tu.owner.user=${userId}`);
			expectSlice(tags, `${PART}:course.tu.owner.user=${userId}`);
			expectSlice(tags, `${TS}:mr.tu.owner.user=${userId}`);
			expectSlice(tags, `${TS}:mr=${mrId}`);
		});

		it(oneLine`
			a withheld part's course moved under the user's teaching unit fills the
			null slot: the course's new slice is the one the read holds
		`, async () => {
			const missed = await expectCached(readRange);

			expect(courseNamesOf(missed)).toEqual(['Course 1', 'Course 2', null]);

			await request(getUrl(vendor, env))
				.patch(`/items/${COURSE}/${strangerCourseId}`)
				.send({ tu: tuId })
				.set('Authorization', admin);

			const after = await readRange();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');

			expect(partNamesOf(after))
				.toEqual(['Partie 1', 'Partie 2', 'Partie stranger']);

			await request(getUrl(vendor, env))
				.patch(`/items/${COURSE}/${strangerCourseId}`)
				.send({ tu: strangerTuId })
				.set('Authorization', admin);

			expect(partNamesOf(await readRange())).toEqual(['Partie 1', 'Partie 2', null]);
		});

		it(oneLine`
			a course moved out from under the user's teaching unit withholds its
			part: the course's old slice is the one the read holds
		`, async () => {
			const missed = await expectCached(readRange);

			expect(partNamesOf(missed)).toEqual(['Partie 1', 'Partie 2', null]);

			await request(getUrl(vendor, env))
				.patch(`/items/${COURSE}/${courseIds[1]}`)
				.send({ tu: strangerTuId })
				.set('Authorization', admin);

			const after = await readRange();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(partNamesOf(after)).toEqual(['Partie 1', null, null]);

			await request(getUrl(vendor, env))
				.patch(`/items/${COURSE}/${courseIds[1]}`)
				.send({ tu: tuId })
				.set('Authorization', admin);
		});

		it(oneLine`
			the teaching unit handed to another owner, two hops above the parts,
			withholds every row under it
		`, async () => {
			await expectCached(readRange);

			await request(getUrl(vendor, env))
				.patch(`/items/${TU}/${tuId}`)
				.send({ owner: strangerOwnerId })
				.set('Authorization', admin);

			const after = await readRange();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data).toEqual([]);

			await request(getUrl(vendor, env))
				.patch(`/items/${TU}/${tuId}`)
				.send({ owner: ownerId })
				.set('Authorization', admin);
		});

		it(oneLine`
			a stranger's part pointed at the user's course surfaces in its slot: the
			part's own slice names the value it moves onto
		`, async () => {
			const missed = await expectCached(readRange);

			expect(partNamesOf(missed)).toEqual(['Partie 1', 'Partie 2', null]);

			await request(getUrl(vendor, env))
				.patch(`/items/${PART}/${strangerPartId}`)
				.send({ course: courseIds[0] })
				.set('Authorization', admin);

			const after = await readRange();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');

			expect(partNamesOf(after))
				.toEqual(['Partie 1', 'Partie 2', 'Partie stranger']);

			await request(getUrl(vendor, env))
				.patch(`/items/${PART}/${strangerPartId}`)
				.send({ course: strangerCourseId })
				.set('Authorization', admin);
		});

		// Off the cases now: the same crossing, written by the admin as a query
		// filter, keyed or not by the shape of what the hop compares.
		const readParts = (filter: Record<string, unknown>) => {
			return request(getUrl(vendor, env))
				.get(`/items/${PART}`)
				.query({ fields: 'id,name', sort: 'name', filter: JSON.stringify(filter) })
				.set('Authorization', admin);
		};

		function expectBare(tags: string, collection: string): void {
			expect(tags, `${collection} not bare — ${whatItPinned(tags)}`)
				.toMatch(new RegExp(`(^|, )${collection}(,|$)`));
		}

		it(oneLine`
			a filter listing the values a scope path may land on slices every hop
			by each of them, and the owner moved off one of them purges the read
		`, async () => {
			const readListed = () => {
				return readParts({
					course: { tu: { owner: { user: { _in: [userId, 'someone-else'] } } } },
				});
			};

			const missed = await expectCached(readListed);

			expect(missed.body.data).toHaveLength(3);

			const tags = missed.headers[cacheTagsHeader];

			for (const value of [userId, 'someone-else']) {
				expectSlice(tags, `${PART}:course.tu.owner.user=${value}`);
				expectSlice(tags, `${COURSE}:tu.owner.user=${value}`);
				expectSlice(tags, `${TU}:owner.user=${value}`);
				expectSlice(tags, `${OWNER}:user=${value}`);
			}

			await request(getUrl(vendor, env))
				.patch(`/items/${OWNER}/${strangerOwnerId}`)
				.send({ user: 'someone-third' })
				.set('Authorization', admin);

			const after = await readListed();

			expect(after.headers[cacheStatusHeader]).toBe('MISS');
			expect(after.body.data).toHaveLength(2);

			await request(getUrl(vendor, env))
				.patch(`/items/${OWNER}/${strangerOwnerId}`)
				.send({ user: 'someone-else' })
				.set('Authorization', admin);
		});

		it(oneLine`
			a filter naming no value along the path bounds the hop to nothing, so
			every collection it crosses stays bare
		`, async () => {
			const missed = await expectCached(() => {
				return readParts({
					course: { tu: { owner: { user: { _neq: 'someone-else' } } } },
				});
			});

			expect(missed.body.data).toHaveLength(2);

			const tags = missed.headers[cacheTagsHeader];

			for (const collection of [PART, COURSE, TU, OWNER]) {
				expectBare(tags, collection);
			}
		});

		it(oneLine`
			a hop comparing two columns at once names no single slice: the near
			collection stays bare while the crossed one keeps its path slice
		`, async () => {
			const missed = await expectCached(() => {
				return readParts({
					course: {
						tu: { owner: { user: { _eq: userId } } },
						name: { _eq: 'Course 1' },
					},
				});
			});

			expect(missed.body.data).toHaveLength(1);

			const tags = missed.headers[cacheTagsHeader];

			expectBare(tags, PART);
			expectSlice(tags, `${COURSE}:tu.owner.user=${userId}`);
		});

		it(oneLine`
			a declared path ending on a column no slice can name leaves the near
			collection bare
		`, async () => {
			const missed = await expectCached(() => {
				return request(getUrl(vendor, env))
					.get(`/items/${TU}`)
					.query({
						fields: 'id,name',
						filter: JSON.stringify({
							owner: { since: { _eq: '2026-01-01T00:00:00' } },
						}),
					})
					.set('Authorization', admin);
			});

			expect(missed.body.data).toHaveLength(1);
			expectBare(missed.headers[cacheTagsHeader], TU);
		});
	});
});
