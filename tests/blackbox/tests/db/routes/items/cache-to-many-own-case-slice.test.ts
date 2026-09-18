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

// The planner's method range, reduced: its time slots hang off the range by an
// fk that is NO scope field of the slot (the slot is scoped by its part alone),
// so no parent-key pin names the slots a range read nests. The user's case on
// the slot — `part.course.tu.owner.user` — is the WHERE every slot node runs
// under, and a slice along that scope path names every slot the read carries;
// a case on a column no slice names leaves the slot bare. A range whose `tu` is
// null nests the ownership ancestors through a null hop, which reaches no row
// and tags nothing at all.
const OWNER = 'ocs_owner';
const TU = 'ocs_tu';
const COURSE = 'ocs_course';
const PART = 'ocs_part';
const SLOT = 'ocs_slot';
const RANGE = 'ocs_range';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a to-many whose scope lacks the fk it hangs off slices by its own case (#518)
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-to-many-own-case-slice-${vendor}`;
		// The suite default is 5; the slot's case walks five hops under the
		// range's to-many.
		env[vendor]['MAX_RELATIONAL_DEPTH'] = '15';

		let instance: ChildProcess;
		let userId: string;
		let rangeId: number;
		let untaughtRangeId: number;
		let strangerTuId: number;
		let ownedPartId: number;
		let ownedSlotId: number;
		let strangerSlotId: number;
		const userToken = `ocs-${vendor}-00000000000000000000000000`;
		const columnCaseUserToken = `ocs-col-${vendor}-0000000000000000000000`;
		const admin = `Bearer ${USER.ADMIN.TOKEN}`;
		const asUser = `Bearer ${userToken}`;
		const asColumnCaseUser = `Bearer ${columnCaseUserToken}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: OWNER,
						meta: { scoped_cache_fields: ['user'] },
						fields: [{ field: 'user', type: 'string', meta: {} }],
					},
					{
						collection: TU,
						meta: { scoped_cache_fields: ['owner'] },
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
						// By its part alone: the range it hangs off names no slice.
						collection: SLOT,
						meta: { scoped_cache_fields: ['part'] },
						fields: [{ field: 'note', type: 'string', meta: {} }],
					},
					{
						collection: RANGE,
						meta: { scoped_cache_fields: ['user_created', 'tu'] },
						fields: [
							{ field: 'method', type: 'string', meta: {} },
							{ field: 'user_created', type: 'string', meta: {} },
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
				collection: SLOT,
				field: 'part',
				otherCollection: PART,
			});

			await CreateFieldM2O(vendor, {
				collection: RANGE,
				field: 'tu',
				otherCollection: TU,
			});

			await CreateFieldO2M(vendor, {
				collection: RANGE,
				field: 'time_slots',
				otherCollection: SLOT,
				otherField: 'range',
			});

			const toUser = { user: { _eq: '$CURRENT_USER' } };

			const createUser = async (
				name: string,
				token: string,
				caseByCollection: Record<string, Record<string, unknown>>,
			): Promise<string> => {
				const response = await request(getUrl(vendor, env))
					.post('/users')
					.set('Authorization', admin)
					.send({
						first_name: name,
						token,
						policies: {
							create: [{
								policy: {
									name: `${name} policy`,
									app_access: true,
									permissions: {
										create: Object.entries(caseByCollection)
											.map(([collection, permissions]) => {
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

				if (!response.ok) {
					throw new Error(
						`Could not create user: ${JSON.stringify(response.body)}`,
					);
				}

				return response.body.data.id;
			};

			const ownRange = { user_created: { _eq: '$CURRENT_USER' } };

			userId = await createUser('own case slice user', userToken, {
				[OWNER]: toUser,
				[TU]: { owner: toUser },
				[COURSE]: { tu: { owner: toUser } },
				[PART]: { course: { tu: { owner: toUser } } },
				[SLOT]: { part: { course: { tu: { owner: toUser } } } },
				// Off the range's own column, not its tu: a range taught by no
				// unit stays visible.
				[RANGE]: ownRange,
			});

			// The same reach, the slot gated on a column of its own that no
			// slice names.
			await createUser('own case column user', columnCaseUserToken, {
				[OWNER]: toUser,
				[TU]: { owner: toUser },
				[COURSE]: { tu: { owner: toUser } },
				[PART]: { course: { tu: { owner: toUser } } },
				[SLOT]: { note: { _nnull: true } },
				[RANGE]: ownRange,
			});

			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [{ user: userId }, { user: 'someone-else' }],
			});

			const tus = await CreateItem(vendor, {
				collection: TU,
				item: [
					{ name: 'UE owned', owner: owners[0].id },
					{ name: 'UE stranger', owner: owners[1].id },
				],
			});

			strangerTuId = tus[1].id;

			const courses = await CreateItem(vendor, {
				collection: COURSE,
				item: [
					{ name: 'course owned', tu: tus[0].id },
					{ name: 'course stranger', tu: tus[1].id },
				],
			});

			const parts = await CreateItem(vendor, {
				collection: PART,
				item: [
					{ name: 'part owned', course: courses[0].id },
					{ name: 'part stranger', course: courses[1].id },
				],
			});

			ownedPartId = parts[0].id;

			const ranges = await CreateItem(vendor, {
				collection: RANGE,
				item: [
					{ method: 'spaced', user_created: userId, tu: tus[0].id },
					{ method: 'untaught', user_created: userId, tu: null },
				],
			});

			rangeId = ranges[0].id;
			untaughtRangeId = ranges[1].id;

			const slots = await CreateItem(vendor, {
				collection: SLOT,
				item: [
					{ range: rangeId, part: parts[0].id, note: 'slot owned' },
					// Hangs off the stranger's part: withheld from the user.
					{ range: rangeId, part: parts[1].id, note: 'slot stranger' },
				],
			});

			ownedSlotId = slots[0].id;
			strangerSlotId = slots[1].id;

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

			for (const collection of [SLOT, RANGE, PART, COURSE, TU, OWNER]) {
				await DeleteCollection(vendor, { collection });
			}
		});

		const readRangeAs = (auth: string, id: number = rangeId) => {
			return request(getUrl(vendor, env))
				.get(`/items/${RANGE}/${id}`)
				.query({ fields: 'id,method,time_slots.note,time_slots.part.name' })
				.set('Authorization', auth);
		};

		const readRange = () => readRangeAs(asUser);

		function patchSlot(id: number, patch: Record<string, unknown>) {
			return request(getUrl(vendor, env))
				.patch(`/items/${SLOT}/${id}`)
				.send(patch)
				.set('Authorization', admin);
		}

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

		const ownCaseSlice = () => `${SLOT}:part.course.tu.owner.user=${userId}`;

		it(oneLine`
			slices the slots by their own case: the node's WHERE gates every row
			it returns, whichever way the read reached it
		`, async () => {
			const response = await readRange();
			const tags: string = response.headers[cacheTagsHeader];

			expect(response.body.data.time_slots).toEqual([
				{ note: 'slot owned', part: { name: 'part owned' } },
			]);

			expect(tags, tags).toMatch(new RegExp(`(^|, )${ownCaseSlice()}(,|$)`));
			expect(tags, tags).not.toMatch(new RegExp(`(^|, )${SLOT}(,|$)`));
			expect(tags, tags).not.toMatch(new RegExp(`(^|, )${SLOT}:range=`));
		});

		it('a write to the slot the case withheld keeps the read cached', async () => {
			await expectCached(readRange);

			await patchSlot(strangerSlotId, { note: 'slot stranger touched' });

			expect((await readRange()).headers[cacheStatusHeader]).toBe('HIT');
		});

		it('a write to a slot the case let through evicts the read', async () => {
			await expectCached(readRange);

			await patchSlot(ownedSlotId, { note: 'slot owned touched' });

			expect((await readRange()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it('a slot moved under the user\'s part evicts the read', async () => {
			await expectCached(readRange);

			await patchSlot(strangerSlotId, { part: ownedPartId });

			expect((await readRange()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it('keeps the slots bare when their case names no slice', async () => {
			const response = await readRangeAs(asColumnCaseUser);
			const tags: string = response.headers[cacheTagsHeader];

			expect(response.status).toBe(200);
			expect(tags, tags).toMatch(new RegExp(`(^|, )${SLOT}(,|$)`));
			expect(tags, tags).not.toMatch(new RegExp(`(^|, )${SLOT}:`));
		});

		it(oneLine`
			tags no ancestor the ownership injection nested through a null hop: a
			chain reaching no row leaves the response as it was
		`, async () => {
			const readUntaught = () => readRangeAs(asUser, untaughtRangeId);
			const response = await expectCached(readUntaught);
			const tags: string = response.headers[cacheTagsHeader];

			expect(response.body.data.time_slots).toEqual([]);

			// What the cases slice stays; what the null hop nested is not named.
			expect(tags, tags).toMatch(
				new RegExp(`(^|, )${TU}:owner.user=${userId}(,|$)`),
			);

			expect(tags, tags).toMatch(
				new RegExp(`(^|, )${RANGE}:id=${untaughtRangeId}(,|$)`),
			);

			for (const collection of [TU, OWNER, PART, SLOT]) {
				expect(tags, tags).not.toMatch(new RegExp(`(^|, )${collection}(,|$)`));
				expect(tags, tags).not.toMatch(new RegExp(`(^|, )${collection}:id=`));
			}

			await request(getUrl(vendor, env))
				.patch(`/items/${TU}/${strangerTuId}`)
				.send({ name: 'UE stranger renamed' })
				.set('Authorization', admin);

			expect((await readUntaught()).headers[cacheStatusHeader]).toBe('HIT');
		});
	});
});
