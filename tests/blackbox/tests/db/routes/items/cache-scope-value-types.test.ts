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

// A scope value reaches the two sides of the cache in two different shapes: the
// read gets it parsed out of a filter (`true`, `'0042'`, `'1.5'`, `'ACME'`) and
// the write reads it back off the driver (`'t'`/`1`, `42`, `'1.50'`, `'acme'`).
// `canonicalScopedCacheValue` is what makes those name ONE slice; when it does
// not, the read pins a key no write ever emits and the entry serves stale for its
// whole TTL — silently, since both sides look right on their own.
//
// Every scoped collection in the suite so far scopes on a plain lowercase string
// column, which is the one case where both shapes already agree. Each field below
// is a shape where they do not, driven end to end: pin the slice, write the row,
// and require the purge to have named the same token the read did.
//
// `dateTime` is the deliberate exception: a naive column comes back as a local
// `Date` from the driver but as an ISO string from a filter, so no token is
// stable across drivers and the read refuses to pin it at all — the bare tag
// instead, which over-purges and cannot go stale.

const TYPED = 'test_scope_value_types';
// Stored lowercase, read back uppercase: the spelling an iOS client's
// `UUID().uuidString` sends while a web client writes the other one.
const REF = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const cacheStatusHeader = 'x-cache-status';
const cacheTagsHeader = 'x-scoped-cache-tags';
const purgedTagsHeader = 'x-scoped-cache-purged-tags';

describe(oneLine`
	a scope value spelled one way by a filter and another by the driver resolves one
	slice, so the read's pin is the token its own write purges
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_TAGS_HEADER'] = cacheTagsHeader;
		env[vendor]['CACHE_PURGED_TAGS_HEADER'] = purgedTagsHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = '6108';
		env[vendor]['CACHE_NAMESPACE'] = `directus-value-types-${vendor}`;

		let instance: ChildProcess;
		let flaggedId: number;
		let serialId: number;
		let amountId: number;
		let tenantId: number;
		let refId: number;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			// One row per field, so a write made for one type never lands in a slice
			// another case is holding.
			await CreateCollections(vendor, {
				collections: [{
					collection: TYPED,
					meta: {
						scoped_cache_fields: [
							'flag',
							'serial',
							'amount',
							'tenant',
							'due',
							'ref',
						],
					},
					fields: [
						{ field: 'flag', type: 'boolean', meta: {} },
						{ field: 'serial', type: 'bigInteger', meta: {} },
						{ field: 'amount', type: 'decimal', meta: {} },
						{ field: 'tenant', type: 'string', meta: {} },
						{ field: 'due', type: 'dateTime', meta: {} },
						{ field: 'ref', type: 'uuid', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				}],
			});

			const rows = await CreateItem(vendor, {
				collection: TYPED,
				item: [
					{ label: 'flagged', flag: true, tenant: 'zzz-flag' },
					{ label: 'serial', serial: 42, tenant: 'zzz-serial' },
					{ label: 'amount', amount: 1.5, tenant: 'zzz-amount' },
					{ label: 'tenant', tenant: 'acme' },
					{
						label: 'due',
						tenant: 'zzz-due',
						due: '2024-03-04T05:06:07',
					},
					{ label: 'ref', tenant: 'zzz-ref', ref: REF },
				],
			});

			flaggedId = rows[0].id;
			serialId = rows[1].id;
			amountId = rows[2].id;
			tenantId = rows[3].id;
			refId = rows[5].id;

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

			await DeleteCollection(vendor, { collection: TYPED });
		});

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		// Filtered on the scoped field alone, so the pin under test cannot have come
		// from a primary key the query also named.
		function readWhere(field: string, value: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${TYPED}`)
				.query({ [`filter[${field}][_eq]`]: value })
				.set('Authorization', auth);
		}

		function touch(id: number) {
			return request(getUrl(vendor, env))
				.patch(`/items/${TYPED}/${id}`)
				.send({ label: `touched-${Date.now()}` })
				.set('Authorization', auth);
		}

		function headerTags(response: request.Response, header: string): string[] {
			return String(response.headers[header] ?? '')
				.split(', ')
				.filter((tag) => tag !== '');
		}

		// Asserting the two labels against each other would pass on a pair that agree
		// with each other and with nothing in Redis, so the HIT→MISS is what ties them
		// to a real key.
		async function expectSliceRoundTrip(options: {
			field: string;
			filterValue: string;
			rowId: number;
			expectedTag: string;
		}) {
			const { field, filterValue, rowId, expectedTag } = options;

			await clearCache();

			const miss = await readWhere(field, filterValue);
			expect(miss.headers[cacheStatusHeader]).toBe('MISS');
			expect(miss.body.data).toHaveLength(1);
			expect(headerTags(miss, cacheTagsHeader)).toContain(expectedTag);

			const hit = await readWhere(field, filterValue);
			expect(hit.headers[cacheStatusHeader]).toBe('HIT');

			const written = await touch(rowId);
			expect(written.statusCode).toBe(200);

			expect(headerTags(written, purgedTagsHeader)).toContain(expectedTag);

			const after = await readWhere(field, filterValue);
			expect(after.headers[cacheStatusHeader]).toBe('MISS');
		}

		it(oneLine`
			pins a boolean slice as the same token the driver's own 't'/1 spelling
			purges
		`, async () => {
			await expectSliceRoundTrip({
				field: 'flag',
				filterValue: 'true',
				rowId: flaggedId,
				expectedTag: `${TYPED}:flag=true`,
			});
		}, 60_000);

		it(oneLine`
			pins a bigInteger slice by magnitude, so a padded filter value and the
			driver's plain integer are one slice
		`, async () => {
			await expectSliceRoundTrip({
				field: 'serial',
				// The spelling that would pin its own key without the leading-zero
				// surgery, while the write only ever emits `42`.
				filterValue: '0042',
				rowId: serialId,
				expectedTag: `${TYPED}:serial=42`,
			});
		}, 60_000);

		it(oneLine`
			pins a decimal slice numerically, so a filter's 1.5 and a stored 1.50 are
			one slice
		`, async () => {
			await expectSliceRoundTrip({
				field: 'amount',
				filterValue: '1.5',
				rowId: amountId,
				expectedTag: `${TYPED}:amount=1.5`,
			});
		}, 60_000);

		it(oneLine`
			folds a string slice's case, so a caller spelling the value ACME pins what
			the stored acme purges
		`, async () => {
			await expectSliceRoundTrip({
				field: 'tenant',
				filterValue: 'acme',
				rowId: tenantId,
				expectedTag: `${TYPED}:tenant=acme`,
			});
		}, 60_000);

		it(oneLine`
			pins the same slice for a differently-cased spelling of the value, since
			both name one row on a case-insensitive collation
		`, async () => {
			await clearCache();

			const upper = await readWhere('tenant', 'ACME');

			// The row count is not the subject: on a case-SENSITIVE vendor the filter
			// matches nothing, and the read still has to pin the slice it would have
			// served — folding two real slices into one there over-purges rather than
			// serving stale.
			expect(headerTags(upper, cacheTagsHeader))
				.toContain(`${TYPED}:tenant=acme`);
		}, 60_000);

		it(oneLine`
			pins a uuid slice by its stored spelling, so the write's own lowercase
			token is the one the read filed
		`, async () => {
			await expectSliceRoundTrip({
				field: 'ref',
				filterValue: REF,
				rowId: refId,
				expectedTag: `${TYPED}:ref=${REF}`,
			});
		}, 60_000);

		it(oneLine`
			pins the lowercase uuid token for an uppercase spelling of it, which the
			database answers with the same row
		`, async () => {
			await clearCache();

			const upper = await readWhere('ref', REF.toUpperCase());

			// The uppercase spelling is what an iOS caller sends; the write side only
			// ever reads the stored lowercase back off the driver. Pinning the caller's
			// spelling would file a key no write emits, and the entry would serve stale
			// for its whole TTL.
			expect(headerTags(upper, cacheTagsHeader))
				.toContain(`${TYPED}:ref=${REF}`);

			const hit = await readWhere('ref', REF.toUpperCase());
			expect(hit.headers[cacheStatusHeader]).toBe('HIT');

			const written = await touch(refId);

			expect(headerTags(written, purgedTagsHeader))
				.toContain(`${TYPED}:ref=${REF}`);

			const after = await readWhere('ref', REF.toUpperCase());
			expect(after.headers[cacheStatusHeader]).toBe('MISS');
		}, 60_000);

		it(oneLine`
			refuses to pin a dateTime slice and takes the bare tag instead, so a write
			to any row of the collection invalidates the read
		`, async () => {
			await clearCache();

			const miss = await readWhere('due', '2024-03-04T05:06:07');
			expect(miss.headers[cacheStatusHeader]).toBe('MISS');

			const tags = headerTags(miss, cacheTagsHeader);

			expect(tags).toContain(TYPED);
			expect(tags.some((tag) => tag.startsWith(`${TYPED}:due=`))).toBe(false);

			expect(
				(await readWhere('due', '2024-03-04T05:06:07'))
					.headers[cacheStatusHeader],
			).toBe('HIT');

			// A row the filter never matched, so only the bare tag can carry this
			// invalidation — the cost the refusal buys.
			await touch(flaggedId);

			expect(
				(await readWhere('due', '2024-03-04T05:06:07'))
					.headers[cacheStatusHeader],
			).toBe('MISS');
		}, 60_000);
	});
});
