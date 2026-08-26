import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateFieldM2O,
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

// Pinning a nested collection by the keys of the parent rows a response carried is
// sound only while the rows of that collection the response DEPENDS ON are a subset
// of the ones it nested. Four queries break that: a root filter on the nested
// collection, a `deep` filter hiding a parent the response still references, and
// either of those written against a collection further down the chain. In all of
// them, a write to a parent row the response never nested changes what the read
// should return, so the entry has to go — only the bare tag covers that.

const COMPANY = 'pin_stale_company';
const OWNER = 'pin_stale_owner';
const OWNED_ITEM = 'pin_stale_owned_item';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	a key pin must not outlive a write to a parent row it never nested (#361)
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-pin-staleness-${vendor}`;

		let instance: ChildProcess;
		let filterMatchedOwnerId: number;
		let filterOtherOwnerId: number;
		let deepMatchedOwnerId: number;
		let deepOtherOwnerId: number;
		let chainedMatchedCompanyId: number;
		let chainedOtherCompanyId: number;
		let grandparentMatchedCompanyId: number;
		let grandparentOtherCompanyId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: COMPANY,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: OWNER,
						fields: [{ field: 'name', type: 'string', meta: {} }],
					},
					{
						collection: OWNED_ITEM,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: OWNER,
				field: 'company',
				otherCollection: COMPANY,
			});

			await CreateFieldM2O(vendor, {
				collection: OWNED_ITEM,
				field: 'owner',
				otherCollection: OWNER,
			});

			// The two cases below reach past `owner`, so each needs a company pair:
			// one the query selects, one it does not.
			const companies = await CreateItem(vendor, {
				collection: COMPANY,
				item: [
					{ name: 'chained-matched' },
					{ name: 'chained-other' },
					{ name: 'grandparent-matched' },
					{ name: 'grandparent-other' },
				],
			});

			chainedMatchedCompanyId = companies[0].id;
			chainedOtherCompanyId = companies[1].id;
			grandparentMatchedCompanyId = companies[2].id;
			grandparentOtherCompanyId = companies[3].id;

			// One pair per case, named apart so each case's filter selects only its own.
			const owners = await CreateItem(vendor, {
				collection: OWNER,
				item: [
					{ name: 'filter-matched' },
					{ name: 'filter-other' },
					{ name: 'deep-matched' },
					{ name: 'deep-other' },
					{ name: 'chained-a', company: chainedMatchedCompanyId },
					{ name: 'chained-b', company: chainedOtherCompanyId },
					{ name: 'grandparent-a', company: grandparentMatchedCompanyId },
					{ name: 'grandparent-b', company: grandparentOtherCompanyId },
				],
			});

			filterMatchedOwnerId = owners[0].id;
			filterOtherOwnerId = owners[1].id;
			deepMatchedOwnerId = owners[2].id;
			deepOtherOwnerId = owners[3].id;

			await CreateItem(vendor, {
				collection: OWNED_ITEM,
				item: [
					{ label: 'filter-a', owner: filterMatchedOwnerId },
					{ label: 'filter-b', owner: filterOtherOwnerId },
					{ label: 'deep-a', owner: deepMatchedOwnerId },
					{ label: 'deep-b', owner: deepOtherOwnerId },
					{ label: 'chained-a', owner: owners[4].id },
					{ label: 'chained-b', owner: owners[5].id },
					{ label: 'grandparent-a', owner: owners[6].id },
					{ label: 'grandparent-b', owner: owners[7].id },
				],
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
			instance.kill();

			await DeleteCollection(vendor, { collection: OWNED_ITEM });
			await DeleteCollection(vendor, { collection: OWNER });
			await DeleteCollection(vendor, { collection: COMPANY });
		});

		it(oneLine`
			a root filter on the parent collection keeps the read bound to rows it
			never nested
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			function readOwnedItemsNamedFilterMatched() {
				return request(url)
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[owner][name][_eq]': 'filter-matched',
						fields: 'id,label,owner.id,owner.name',
					})
					.set('Authorization', auth);
			}

			const warm = await readOwnedItemsNamedFilterMatched();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(1);

			// This owner was never nested by the read above, but renaming it moves its
			// item INTO the filtered set, so the cached body is now wrong.
			await request(url)
				.patch(`/items/${OWNER}/${filterOtherOwnerId}`)
				.send({ name: 'filter-matched' })
				.set('Authorization', auth);

			const written = await request(url)
				.get(`/items/${OWNER}/${filterOtherOwnerId}`)
				.set('Authorization', auth);

			expect(written.body.data.name).toBe('filter-matched');

			const refetched = await readOwnedItemsNamedFilterMatched();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
			expect(refetched.body.data).toHaveLength(2);
		});

		it(oneLine`
			a deep filter that hid a parent keeps the read bound to that parent
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			function readDeepItemsWithMatchedOwner() {
				return request(url)
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[label][_starts_with]': 'deep-',
						fields: 'id,label,owner.id,owner.name',
						'deep[owner][_filter][name][_eq]': 'deep-matched',
						sort: 'label',
					})
					.set('Authorization', auth);
			}

			const warm = await readDeepItemsWithMatchedOwner();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(2);

			// The second row references this owner but the deep filter hid it, so the
			// response carries `owner: null` — indistinguishable from a null column.
			expect(warm.body.data[1].owner).toBe(null);

			await request(url)
				.patch(`/items/${OWNER}/${deepOtherOwnerId}`)
				.send({ name: 'deep-matched' })
				.set('Authorization', auth);

			const written = await request(url)
				.get(`/items/${OWNER}/${deepOtherOwnerId}`)
				.set('Authorization', auth);

			expect(written.body.data.name).toBe('deep-matched');

			const refetched = await readDeepItemsWithMatchedOwner();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
			expect(refetched.body.data[1].owner).not.toBe(null);
		});

		it(oneLine`
			a nested node's filter keeps the read bound to the collection that
			filter reads, not only to the parent it withholds
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			function readChainedItemsWithMatchedCompany() {
				return request(url)
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[label][_starts_with]': 'chained-',
						fields: 'id,label,owner.id,owner.company.id',
						'deep[owner][_filter][company][name][_eq]': 'chained-matched',
						sort: 'label',
					})
					.set('Authorization', auth);
			}

			const warm = await readChainedItemsWithMatchedCompany();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(2);

			// The owner of the second row belongs to the other company, so the
			// filter withheld it — and its company never reached the response.
			expect(warm.body.data[0].owner.company.id).toBe(chainedMatchedCompanyId);
			expect(warm.body.data[1].owner).toBe(null);

			await request(url)
				.patch(`/items/${COMPANY}/${chainedOtherCompanyId}`)
				.send({ name: 'chained-matched' })
				.set('Authorization', auth);

			const written = await request(url)
				.get(`/items/${COMPANY}/${chainedOtherCompanyId}`)
				.set('Authorization', auth);

			expect(written.body.data.name).toBe('chained-matched');

			const refetched = await readChainedItemsWithMatchedCompany();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
			expect(refetched.body.data[1].owner).not.toBe(null);
		});

		it(oneLine`
			a deep filter on a grandparent node keeps the read bound to that
			grandparent
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			function readGrandparentItemsWithMatchedCompany() {
				return request(url)
					.get(`/items/${OWNED_ITEM}`)
					.query({
						'filter[label][_starts_with]': 'grandparent-',
						fields: 'id,label,owner.id,owner.company.id',
						'deep[owner][company][_filter][name][_eq]': 'grandparent-matched',
						sort: 'label',
					})
					.set('Authorization', auth);
			}

			const warm = await readGrandparentItemsWithMatchedCompany();
			expect(warm.headers[cacheStatusHeader]).toBe('MISS');
			expect(warm.body.data).toHaveLength(2);

			// Both owners come back — only the company of the second is withheld,
			// one level below the node the deep filter names.
			expect(warm.body.data[0].owner.company.id)
				.toBe(grandparentMatchedCompanyId);
			expect(warm.body.data[1].owner).not.toBe(null);
			expect(warm.body.data[1].owner.company).toBe(null);

			await request(url)
				.patch(`/items/${COMPANY}/${grandparentOtherCompanyId}`)
				.send({ name: 'grandparent-matched' })
				.set('Authorization', auth);

			const written = await request(url)
				.get(`/items/${COMPANY}/${grandparentOtherCompanyId}`)
				.set('Authorization', auth);

			expect(written.body.data.name).toBe('grandparent-matched');

			const refetched = await readGrandparentItemsWithMatchedCompany();

			expect(refetched.headers[cacheStatusHeader]).toBe('MISS');
			expect(refetched.body.data[1].owner.company).not.toBe(null);
		});
	});
});
