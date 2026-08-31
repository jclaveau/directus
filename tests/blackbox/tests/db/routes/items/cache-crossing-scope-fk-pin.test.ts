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

// A filter that crosses an M2O and lands on the FAR primary key is answered by the
// near row's own foreign key column, so the far collection needs no tag. When that
// foreign key IS a flat scope field of the near collection, the same filter bounds
// the near collection to that value — so it pins `near:<fk>=value` instead of the
// bare tag it used to carry. The write side already emits that slice on every write
// of the near collection (flat scope field, old ∪ new), so read and write agree.
// The shape mirrors the planner's cursus menu: membership → profile → account, with
// a filter `profile.account._eq $CURRENT_USER` on the `account` scope field.

const ACCOUNT = 'crossing_fk_account';
const PROFILE = 'crossing_fk_profile';
const MEMBERSHIP = 'crossing_fk_membership';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	a filter crossing an M2O onto a scope-field foreign key pins the near collection
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-crossing-scope-fk-${vendor}`;

		let instance: ChildProcess;
		let boundAccountId: number;
		let otherAccountId: number;
		let boundProfileId: number;
		let membershipId: number;
		let fetchedProfileId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ACCOUNT,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: PROFILE,
						meta: { scoped_cache_fields: ['account'] },
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
					{
						collection: MEMBERSHIP,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: PROFILE,
				field: 'account',
				otherCollection: ACCOUNT,
			});

			// A plain M2O onto the same collection, NOT a scope field: the control that
			// a crossing fk which is not a scope field stays bare.
			await CreateFieldM2O(vendor, {
				collection: PROFILE,
				field: 'reviewer',
				otherCollection: ACCOUNT,
			});

			await CreateFieldM2O(vendor, {
				collection: MEMBERSHIP,
				field: 'profile',
				otherCollection: PROFILE,
			});

			// An o2m whose reverse fk is NOT a scope field of the profile, so the child
			// pinner declines it: fetching through it nests unbounded profile rows.
			await CreateFieldO2M(vendor, {
				collection: MEMBERSHIP,
				field: 'profiles',
				otherCollection: PROFILE,
				otherField: 'membership_ref',
			});

			const accounts = await CreateItem(vendor, {
				collection: ACCOUNT,
				item: [{ name: 'bound' }, { name: 'other' }],
			});

			boundAccountId = accounts[0].id;
			otherAccountId = accounts[1].id;

			const profiles = await CreateItem(vendor, {
				collection: PROFILE,
				item: [{
					label: 'p',
					account: boundAccountId,
					reviewer: otherAccountId,
				}],
			});

			boundProfileId = profiles[0].id;

			const memberships = await CreateItem(vendor, {
				collection: MEMBERSHIP,
				item: [{ name: 'm', profile: boundProfileId }],
			});

			membershipId = memberships[0].id;

			// A profile of the OTHER account, reachable through the declined o2m — the
			// row a keyed `account=bound` slice would wrongly exclude, so the read must
			// keep the bare tag when it fetches profile rows.
			const fetchedProfiles = await CreateItem(vendor, {
				collection: PROFILE,
				item: [{
					label: 'fetched',
					account: otherAccountId,
					membership_ref: membershipId,
				}],
			});

			fetchedProfileId = fetchedProfiles[0].id;

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

			await DeleteCollection(vendor, { collection: MEMBERSHIP });
			await DeleteCollection(vendor, { collection: PROFILE });
			await DeleteCollection(vendor, { collection: ACCOUNT });
		});

		// `fields` asks for no profile column, so the profile is reached through the
		// filter and nowhere else — the join-only shape that used to tag it bare.
		function readMembershipsOfBoundAccount() {
			return request(getUrl(vendor, env))
				.get(`/items/${MEMBERSHIP}`)
				.query({
					'filter[profile][account][_eq]': String(boundAccountId),
					fields: 'id,name',
				})
				.set('Authorization', auth);
		}

		// Fetches profile rows through the declined o2m AND keys profile:account: the
		// collection is both nested and filtered, so the guard must keep it bare.
		function readMembershipWithProfiles() {
			return request(getUrl(vendor, env))
				.get(`/items/${MEMBERSHIP}`)
				.query({
					'filter[profile][account][_eq]': String(boundAccountId),
					fields: 'id,name,profiles.*',
				})
				.set('Authorization', auth);
		}

		async function clearCache() {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		it(oneLine`
			pins the near collection by its scope-field foreign key, not bare
		`, async () => {
			await clearCache();

			const tags = (await readMembershipsOfBoundAccount())
				.headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${PROFILE}:account=${boundAccountId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${PROFILE}(,|$)`));
		});

		it(oneLine`
			leaves the far collection the fk answers untagged
		`, async () => {
			await clearCache();

			const tags = (await readMembershipsOfBoundAccount())
				.headers[cacheTagsHeader];

			expect(tags).not.toMatch(new RegExp(`(^|, )${ACCOUNT}(:|,|$)`));
		});

		it(oneLine`
			unions the scope-field slices an _in names
		`, async () => {
			await clearCache();

			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${MEMBERSHIP}`)
				.query({
					'filter[profile][account][_in]':
						`${boundAccountId},${otherAccountId}`,
					fields: 'id,name',
				})
				.set('Authorization', auth))
				.headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${PROFILE}:account=${boundAccountId}(,|$)`),
			);

			expect(tags).toMatch(
				new RegExp(`(^|, )${PROFILE}:account=${otherAccountId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${PROFILE}(,|$)`));
		});

		it(oneLine`
			leaves the near collection bare when the crossing fk is not a scope field
		`, async () => {
			// A write moving a reviewer onto a matching row emits no slice the read
			// could have pinned, so the honest answer stays bare.
			await clearCache();

			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${MEMBERSHIP}`)
				.query({
					'filter[profile][reviewer][_eq]': String(otherAccountId),
					fields: 'id,name',
				})
				.set('Authorization', auth))
				.headers[cacheTagsHeader];

			expect(tags).not.toMatch(new RegExp(`(^|, )${PROFILE}:reviewer=`));

			expect(tags).toMatch(new RegExp(`(^|, )${PROFILE}(,|$)`));
		});

		it(oneLine`
			evicts on a write to a profile the slice named, survives one it did not
		`, async () => {
			await clearCache();

			await readMembershipsOfBoundAccount();

			const otherProfiles = await CreateItem(vendor, {
				collection: PROFILE,
				item: [{ label: 'q', account: otherAccountId }],
			});

			await request(getUrl(vendor, env))
				.patch(`/items/${PROFILE}/${otherProfiles[0].id}`)
				.send({ label: 'q2' })
				.set('Authorization', auth);

			expect((await readMembershipsOfBoundAccount())
				.headers[cacheStatusHeader]).toBe('HIT');

			await request(getUrl(vendor, env))
				.patch(`/items/${PROFILE}/${boundProfileId}`)
				.send({ label: 'p2' })
				.set('Authorization', auth);

			expect((await readMembershipsOfBoundAccount())
				.headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			evicts on an insert of a profile carrying the slice's value
		`, async () => {
			// The scope-field slice must catch an INSERT the read never nested: a new
			// profile with the bound account joins the filter, and the write emits the
			// slice on create, so the pin drops the stale read.
			await clearCache();

			await readMembershipsOfBoundAccount();

			expect((await readMembershipsOfBoundAccount())
				.headers[cacheStatusHeader]).toBe('HIT');

			await request(getUrl(vendor, env))
				.post(`/items/${PROFILE}`)
				.send({ label: 'inserted', account: boundAccountId })
				.set('Authorization', auth);

			expect((await readMembershipsOfBoundAccount())
				.headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			keeps the bare tag when it also fetches the collection it keyed
		`, async () => {
			// The keyed slice bounds the FILTERED rows, but this read also nests
			// profile rows through the declined o2m, which the filter never bounded —
			// so the bare tag must win, or a write to a fetched row would leave it stale.
			await clearCache();

			const tags = (await readMembershipWithProfiles())
				.headers[cacheTagsHeader];

			expect(tags).toMatch(new RegExp(`(^|, )${PROFILE}(,|$)`));

			expect(tags).not.toMatch(new RegExp(`(^|, )${PROFILE}:account=`));

			// Non-vacuity: a write to the fetched OTHER-account profile — a row a keyed
			// `account=bound` slice would not name — still drops the read.
			expect((await readMembershipWithProfiles())
				.headers[cacheStatusHeader]).toBe('HIT');

			await request(getUrl(vendor, env))
				.patch(`/items/${PROFILE}/${fetchedProfileId}`)
				.send({ label: 'fetched2' })
				.set('Authorization', auth);

			expect((await readMembershipWithProfiles())
				.headers[cacheStatusHeader]).toBe('MISS');
		});

		it(oneLine`
			unions the scope-field slices an _or of crossings names
		`, async () => {
			await clearCache();

			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${MEMBERSHIP}`)
				.query({
					'filter[_or][0][profile][account][_eq]': String(boundAccountId),
					'filter[_or][1][profile][account][_eq]': String(otherAccountId),
					fields: 'id,name',
				})
				.set('Authorization', auth))
				.headers[cacheTagsHeader];

			expect(tags).toMatch(
				new RegExp(`(^|, )${PROFILE}:account=${boundAccountId}(,|$)`),
			);

			expect(tags).toMatch(
				new RegExp(`(^|, )${PROFILE}:account=${otherAccountId}(,|$)`),
			);

			expect(tags).not.toMatch(new RegExp(`(^|, )${PROFILE}(,|$)`));
		});

		it(oneLine`
			bares the near collection when an _or branch leaves it unbounded
		`, async () => {
			// One branch keys profile:account, the other filters profile by a non-key
			// column — a row matching it carries any account, so the pin cannot hold
			// and bare wins (an _or is sound only when every branch is covered).
			await clearCache();

			const tags = (await request(getUrl(vendor, env))
				.get(`/items/${MEMBERSHIP}`)
				.query({
					'filter[_or][0][profile][account][_eq]': String(boundAccountId),
					'filter[_or][1][profile][label][_eq]': 'nomatch',
					fields: 'id,name',
				})
				.set('Authorization', auth))
				.headers[cacheTagsHeader];

			expect(tags).not.toMatch(new RegExp(`(^|, )${PROFILE}:account=`));

			expect(tags).toMatch(new RegExp(`(^|, )${PROFILE}(,|$)`));
		});
	});
});
