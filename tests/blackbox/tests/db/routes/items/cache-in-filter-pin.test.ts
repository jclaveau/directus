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

// An `_eq` filter bounds a read to one slice, and every cache spec so far is
// written with one. `_in` bounds it to a KNOWN SET of them, which is just as
// sound a pin — the read depends on those slices and no others — but it is
// extracted by a separate branch on each of the three filter shapes the keying
// walks: a flat column, a relational M2O written PK-unwrapped, and the terminal
// of a composed path.
//
// Left unread, an `_in` falls through as unkeyed and bares the collection: every
// write anywhere in it drops this entry, so nothing is ever stale and nothing
// ever shows in a test that only asserts freshness. What it costs is the hit
// ratio, invisibly — which is why each case below asserts BOTH halves: the named
// slices invalidate the entry, and a sibling slice leaves it alone.

const ZONED = 'in_filter_zoned';
const SLICED = 'in_filter_sliced';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	an _in filter pins each value it names, so the read depends on those slices and
	not on the whole collection
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-in-filter-${vendor}`;

		let instance: ChildProcess;
		let northId: number;
		let southId: number;
		let eastId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: ZONED,
						meta: { scoped_cache_fields: ['zone'] },
						fields: [{ field: 'zone', type: 'string', meta: {} }],
					},
					{
						collection: SLICED,
						fields: [
							{ field: 'label', type: 'string', meta: {} },
							{ field: 'owner', type: 'string', meta: {} },
						],
					},
				],
			});

			await CreateFieldM2O(vendor, {
				collection: SLICED,
				field: 'parent',
				otherCollection: ZONED,
			});

			// After the m2o exists, and before the spawn: the composed `parent.zone`
			// path is derived from these two declarations at boot.
			await request(getUrl(vendor, env))
				.patch(`/collections/${SLICED}`)
				.send({ meta: { scoped_cache_fields: ['owner', 'parent'] } })
				.set('Authorization', auth);

			const zones = await CreateItem(vendor, {
				collection: ZONED,
				item: [{ zone: 'north' }, { zone: 'south' }, { zone: 'east' }],
			});

			northId = zones[0].id;
			southId = zones[1].id;
			eastId = zones[2].id;

			await CreateItem(vendor, {
				collection: SLICED,
				item: [
					{ label: 'n', owner: 'a', parent: northId },
					{ label: 's', owner: 'b', parent: southId },
					{ label: 'e', owner: 'c', parent: eastId },
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
			instance?.kill();

			await DeleteCollection(vendor, { collection: SLICED });
			await DeleteCollection(vendor, { collection: ZONED });
		});

		function read(query: Record<string, string>) {
			return request(getUrl(vendor, env))
				.get(`/items/${SLICED}`)
				.query(query)
				.set('Authorization', auth);
		}

		function addRow(item: Record<string, unknown>) {
			return request(getUrl(vendor, env))
				.post(`/items/${SLICED}`)
				.send(item)
				.set('Authorization', auth);
		}

		async function expectPinnedSet(options: {
			query: Record<string, string>;
			expectedTags: string[];
			invalidatingRow: Record<string, unknown>;
			indifferentRow: Record<string, unknown>;
		}) {
			const { query, expectedTags, invalidatingRow, indifferentRow } = options;

			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const miss = await read(query);
			expect(miss.headers[cacheStatusHeader]).toBe('MISS');

			const tags = String(miss.headers[cacheTagsHeader] ?? '')
				.split(', ')
				.filter((tag) => tag !== '');

			for (const expected of expectedTags) {
				expect(tags).toContain(expected);
			}

			// The pin is only worth anything if the collection is NOT also bare: a bare
			// tag would invalidate on both writes below and pass the freshness half of
			// this test while pinning nothing.
			expect(tags).not.toContain(SLICED);

			expect((await read(query)).headers[cacheStatusHeader]).toBe('HIT');

			await addRow(indifferentRow);
			expect((await read(query)).headers[cacheStatusHeader]).toBe('HIT');

			await addRow(invalidatingRow);
			expect((await read(query)).headers[cacheStatusHeader]).toBe('MISS');
		}

		it(oneLine`
			pins every value a flat column's _in names, and nothing outside them
		`, async () => {
			await expectPinnedSet({
				query: { 'filter[owner][_in]': 'a,b' },
				expectedTags: [`${SLICED}:owner=a`, `${SLICED}:owner=b`],
				invalidatingRow: { label: 'a2', owner: 'a', parent: northId },
				indifferentRow: { label: 'c2', owner: 'c', parent: eastId },
			});
		}, 60_000);

		it(oneLine`
			pins every key a relational _in names, written PK-unwrapped as the fk slice
			the write side emits
		`, async () => {
			await expectPinnedSet({
				query: { 'filter[parent][id][_in]': `${northId},${southId}` },
				expectedTags: [
					`${SLICED}:parent=${northId}`,
					`${SLICED}:parent=${southId}`,
				],
				invalidatingRow: { label: 'n2', owner: 'a', parent: northId },
				indifferentRow: { label: 'e2', owner: 'c', parent: eastId },
			});
		}, 60_000);

		it(oneLine`
			pins every terminal a composed path's _in names, so the derived slice is
			bounded the same way a direct column is
		`, async () => {
			await expectPinnedSet({
				query: { 'filter[parent][zone][_in]': 'north,south' },
				expectedTags: [
					`${SLICED}:parent.zone=north`,
					`${SLICED}:parent.zone=south`,
				],
				invalidatingRow: { label: 'n3', owner: 'a', parent: northId },
				indifferentRow: { label: 'e3', owner: 'c', parent: eastId },
			});
		}, 60_000);
	});
});
