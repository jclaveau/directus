import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
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

// A disjunction keys only when every branch names the SAME field: the read is
// then bounded to that field's named slices and can be pinned to them. Branches
// on different fields name no single axis — the read spans rows no one slice
// covers — so the collection goes bare, which over-purges and cannot go stale.
//
// The same fallback catches any operator the keying walk cannot compile. `_not`
// is the live one: `applyFilter` drops it rather than compiling it, so the rows
// actually returned are not the rows the filter reads as, and everything under
// it has to be unkeyed.
//
// Both cases look identical from the outside — a fresh response either way — so
// the keyed contrast is what makes the bare ones mean anything: without it, a
// keying walk that simply gave up on `_or` would pass every assertion here.

const SLICED = 'or_filter_sliced';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	an _or over one field keys to its named slices, while one over two fields — or
	an operator the walk cannot read — bares the collection
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-or-filter-${vendor}`;

		let instance: ChildProcess;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [{
					collection: SLICED,
					meta: { scoped_cache_fields: ['owner', 'stage'] },
					fields: [
						{ field: 'label', type: 'string', meta: {} },
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'stage', type: 'string', meta: {} },
					],
				}],
			});

			await CreateItem(vendor, {
				collection: SLICED,
				item: [
					{ label: 'a-draft', owner: 'a', stage: 'draft' },
					{ label: 'b-live', owner: 'b', stage: 'live' },
					{ label: 'c-done', owner: 'c', stage: 'done' },
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
		});

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		function readFiltered(filter: unknown) {
			return request(getUrl(vendor, env))
				.get(`/items/${SLICED}`)
				.query({ filter: JSON.stringify(filter) })
				.set('Authorization', auth);
		}

		function addRow(item: Record<string, string>) {
			return request(getUrl(vendor, env))
				.post(`/items/${SLICED}`)
				.send(item)
				.set('Authorization', auth);
		}

		function tagsOf(response: request.Response): string[] {
			return String(response.headers[cacheTagsHeader] ?? '')
				.split(', ')
				.filter((tag) => tag !== '');
		}

		// The write lands in a slice NO branch of the filter names, so only a bare
		// tag can carry the invalidation.
		async function expectBareOver(filter: unknown) {
			await clearCache();

			const miss = await readFiltered(filter);
			expect(miss.headers[cacheStatusHeader]).toBe('MISS');
			expect(tagsOf(miss)).toContain(SLICED);

			expect(
				(await readFiltered(filter)).headers[cacheStatusHeader],
			).toBe('HIT');

			await addRow({ label: 'z', owner: 'z', stage: 'archived' });

			expect(
				(await readFiltered(filter)).headers[cacheStatusHeader],
			).toBe('MISS');
		}

		it(oneLine`
			keys an _or whose branches name one field, pinning each value and leaving
			the collection unbared
		`, async () => {
			const filter = {
				_or: [{ owner: { _eq: 'a' } }, { owner: { _eq: 'b' } }],
			};

			await clearCache();

			const miss = await readFiltered(filter);
			expect(miss.headers[cacheStatusHeader]).toBe('MISS');

			const tags = tagsOf(miss);
			expect(tags).toContain(`${SLICED}:owner=a`);
			expect(tags).toContain(`${SLICED}:owner=b`);
			expect(tags).not.toContain(SLICED);

			expect(
				(await readFiltered(filter)).headers[cacheStatusHeader],
			).toBe('HIT');

			await addRow({ label: 'c2', owner: 'c', stage: 'done' });

			expect(
				(await readFiltered(filter)).headers[cacheStatusHeader],
			).toBe('HIT');

			await addRow({ label: 'a2', owner: 'a', stage: 'draft' });

			expect(
				(await readFiltered(filter)).headers[cacheStatusHeader],
			).toBe('MISS');
		}, 60_000);

		it(oneLine`
			bares the collection for an _or whose branches name different fields, since
			no single axis covers the rows it returns
		`, async () => {
			await expectBareOver({
				_or: [{ owner: { _eq: 'a' } }, { stage: { _eq: 'live' } }],
			});
		}, 60_000);

		it(oneLine`
			bares the collection under a _not, whose condition the query never compiles
			and the keying must not read as a bound
		`, async () => {
			await expectBareOver({ _not: { owner: { _eq: 'a' } } });
		}, 60_000);
	});
});
