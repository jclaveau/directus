import config, { getUrl, paths } from '@common/config';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The NULL scope token opens with a raw NUL so it can never collide with a
// literal 'null' in a Redis key. That byte is illegal in an HTTP header, so
// rendering the tag into `CACHE_PURGED_TAGS_HEADER` made `res.setHeader` throw
// ERR_INVALID_CHAR — AFTER the row had committed. Every write to a collection
// whose scope field was null came back 500 with the item created, and only
// while the debug header was on. A unit test on the display form cannot see
// this: the throw happens in `respond`.

const COLLECTION = 'test_items_null_scope';
const purgedTagsHeader = 'x-scoped-cache-purged-tags';
const tagsHeader = 'x-scoped-cache-tags';
const statusHeader = 'x-cache-status';

function carriesControlByte(value: string): boolean {
	return Array.from(value).some((char) => {
		const code = char.charCodeAt(0);
		return code < 0x20 || code === 0x7F;
	});
}

describe(oneLine`
	a write whose scope field is null still succeeds, and renders a header the HTTP
	layer accepts
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-null-scope-${vendor}`;
		// The trigger: without it the tags are never rendered and the write survives.
		env[vendor]['CACHE_PURGED_TAGS_HEADER'] = purgedTagsHeader;
		env[vendor]['CACHE_TAGS_HEADER'] = tagsHeader;
		env[vendor]['CACHE_STATUS_HEADER'] = statusHeader;
		// The admin cache tree resolves an entry through its descriptor, which is
		// written by the stats pipeline rather than by the fill.
		env[vendor]['CACHE_STATS_ENABLED'] = 'true';

		let instance: ChildProcess;

		beforeAll(async () => {
			// Seed before the scoped instance spawns so it sees `scoped_cache_fields` on
			// boot. `owner` is nullable, which is the whole point.
			await CreateCollections(vendor, {
				collections: [{
					collection: COLLECTION,
					meta: { scoped_cache_fields: ['owner'] },
					fields: [
						{ field: 'owner', type: 'string', meta: {} },
						{ field: 'amount', type: 'string', meta: {} },
					],
				}],
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

			await DeleteCollection(vendor, { collection: COLLECTION });
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function createItem(item: Record<string, string>) {
			return request(getUrl(vendor, env))
				.post(`/items/${COLLECTION}`)
				.send(item)
				.set('Authorization', auth);
		}

		it('creates a row whose scope value is null', async () => {
			const response = await createItem({ amount: '5' });

			expect(response.statusCode).toBe(200);
			expect(response.body.data.owner).toBe(null);
		});

		it('escapes the null scope in the purged tags header', async () => {
			const response = await createItem({ amount: '7' });

			const header = response.headers[purgedTagsHeader];
			expect(carriesControlByte(header)).toBe(false);
			expect(header.split(', ')).toContain(`${COLLECTION}:owner=%00null`);
		});

		// A read pinned to `_eq: null` stores the raw token in the __tags sidecar, so
		// the HIT re-emits it from cache.ts — the escaping site the MISS never reaches.
		it(oneLine`
			escapes the null scope again when the read is served from cache
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			function readNullOwner() {
				return request(url)
					.get(`/items/${COLLECTION}`)
					.query({ filter: JSON.stringify({ owner: { _eq: null } }) })
					.set('Authorization', auth);
			}

			const miss = await readNullOwner();
			expect(miss.statusCode).toBe(200);
			expect(miss.headers[statusHeader]).toBe('MISS');

			const hit = await readNullOwner();
			expect(hit.statusCode).toBe(200);
			expect(hit.headers[statusHeader]).toBe('HIT');

			const header = hit.headers[tagsHeader];
			expect(carriesControlByte(header)).toBe(false);
			expect(header.split(', ')).toContain(`${COLLECTION}:owner=%00null`);
		});

		// The other place the raw token has to survive: the blast radius the admin
		// tree shows is an SCARD of the tag's own Redis key, rebuilt from the display
		// label. A label spelled `null` where the key holds `\x00null` scards a key
		// that does not exist and reports 0 — a slice indexing entries would read as
		// reaching none of them.
		it(oneLine`
			counts the members of a null scope slice, whose Redis key the display label
			has to be turned back into
		`, async () => {
			const url = getUrl(vendor, env);

			await request(url)
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const miss = await request(url)
				.get(`/items/${COLLECTION}`)
				.query({ filter: JSON.stringify({ owner: { _eq: null } }) })
				.set('Authorization', auth);

			expect(miss.headers[statusHeader]).toBe('MISS');

			// The descriptor drains on the stats cron, so the entry is listable a few
			// ticks after the fill that created it.
			let filled: any;

			for (let attempt = 0; attempt < 45 && filled === undefined; attempt++) {
				const listed = await request(url).get('/utils/cache')
					.set('Authorization', auth);

				expect(listed.statusCode).toBe(200);

				filled = listed.body.data.find((row: any) => {
					return row.path === `/items/${COLLECTION}` && row.redisKey;
				});

				if (filled === undefined) {
					await new Promise((resolve) => setTimeout(resolve, 1000));
				}
			}

			expect(filled).toBeDefined();

			const entry = await request(url).get('/utils/cache/entry')
				.query({ key: filled.redisKey })
				.set('Authorization', auth);

			expect(entry.statusCode).toBe(200);
			expect(entry.body.data.exists).toBe(true);

			const nullTag = `${COLLECTION}:owner=\u0000null`;

			expect(entry.body.data.tags).toContain(nullTag);

			// Zero is exactly what a mis-spelled key returns, so this is the whole
			// assertion — the entry and its sidecars are all filed under the slice.
			expect(entry.body.data.tagCounts[nullTag]).toBeGreaterThan(0);
		}, 60_000);

		// The control: a present scope value was never affected, so a regression that
		// broke escaping wholesale would still show up here.
		it('leaves a non-null scope value unescaped', async () => {
			const response = await createItem({ owner: 'acme', amount: '9' });

			expect(response.statusCode).toBe(200);

			const header = response.headers[purgedTagsHeader];
			expect(header.split(', ')).toContain(`${COLLECTION}:owner=acme`);
		});
	});
});
