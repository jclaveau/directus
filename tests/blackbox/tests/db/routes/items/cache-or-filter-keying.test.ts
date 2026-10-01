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

// Two analyses read a disjunction and they do not agree, on purpose. The KEYING
// walk asks whether one axis bounds the read, so branches on different fields
// leave it unkeyed. The root PIN unions instead: the rows returned are the rows
// of `owner=a` plus the rows of `stage=live`, and tagging both covers all of
// them. The union is what survives into the response's tags, so a two-field `_or`
// is pinned, not bared — the keying's answer only governs what a NESTED
// collection may lean on.
//
// What does bare is an operator that names no value at all. Only `_eq` and `_in`
// key: every other operator describes rows by what they are not, and a write can
// move a row across that boundary without touching any slice the read named.
//
// All three shapes stay fresh, so freshness cannot tell them apart — the pins are
// the assertion, and each case pairs them with a write that must NOT invalidate.

const SLICED = 'or_filter_sliced';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';

describe(oneLine`
	an _or pins the union of the slices its branches name, while an operator naming
	no value bares the collection
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

		async function expectPinned(options: {
			filter: unknown;
			expectedTags: string[];
			invalidatingRow: Record<string, string>;
			indifferentRow: Record<string, string>;
		}) {
			const { filter, expectedTags, invalidatingRow, indifferentRow } = options;

			await clearCache();

			const miss = await readFiltered(filter);
			expect(miss.headers[cacheStatusHeader]).toBe('MISS');

			const tags = tagsOf(miss);

			for (const expected of expectedTags) {
				expect(tags).toContain(expected);
			}

			// A bare tag would invalidate on both writes below, passing the freshness
			// half of this while pinning nothing.
			expect(tags).not.toContain(SLICED);

			expect(
				(await readFiltered(filter)).headers[cacheStatusHeader],
			).toBe('HIT');

			await addRow(indifferentRow);

			expect(
				(await readFiltered(filter)).headers[cacheStatusHeader],
			).toBe('HIT');

			await addRow(invalidatingRow);

			expect(
				(await readFiltered(filter)).headers[cacheStatusHeader],
			).toBe('MISS');
		}

		it(oneLine`
			pins each value an _or over one field names
		`, async () => {
			await expectPinned({
				filter: {
					_or: [{ owner: { _eq: 'a' } }, { owner: { _eq: 'b' } }],
				},
				expectedTags: [`${SLICED}:owner=a`, `${SLICED}:owner=b`],
				invalidatingRow: { label: 'a2', owner: 'a', stage: 'draft' },
				indifferentRow: { label: 'c2', owner: 'c', stage: 'done' },
			});
		}, 60_000);

		it(oneLine`
			pins both axes of an _or over two fields, since the rows it returns are the
			union of the two slices rather than rows no slice covers
		`, async () => {
			await expectPinned({
				filter: {
					_or: [{ owner: { _eq: 'a' } }, { stage: { _eq: 'live' } }],
				},
				expectedTags: [`${SLICED}:owner=a`, `${SLICED}:stage=live`],
				invalidatingRow: { label: 'b2', owner: 'b', stage: 'live' },
				// In neither branch's slice, so it belongs in neither result.
				indifferentRow: { label: 'z', owner: 'z', stage: 'archived' },
			});
		}, 60_000);

		it(oneLine`
			bares the collection for an operator naming no value, so a write anywhere in
			it invalidates the read
		`, async () => {
			const filter = { owner: { _nnull: true } };

			await clearCache();

			const miss = await readFiltered(filter);
			expect(miss.headers[cacheStatusHeader]).toBe('MISS');
			expect(tagsOf(miss)).toContain(SLICED);

			expect(
				(await readFiltered(filter)).headers[cacheStatusHeader],
			).toBe('HIT');

			// A slice no branch could have named, since the filter named none: only
			// the bare tag can carry this.
			await addRow({ label: 'z2', owner: 'z', stage: 'archived' });

			expect(
				(await readFiltered(filter)).headers[cacheStatusHeader],
			).toBe('MISS');
		}, 60_000);
	});
});
