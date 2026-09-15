import config, { getUrl, paths } from '@common/config';
import { CreateCollections, CreateItem, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// End-to-end witness for `context.scopedCache.dependOn`: a read hook hands the
// lookups it ran to `dependOn` as it has them — pending, already awaited, a
// `Promise.all` batch, or `Promise.allSettled` verdicts — and the read is scoped to
// every fulfilled lookup's slice WITH that lookup's purge counters. `scopeTo` takes
// the same pair spelled out; `dependOn` is the one-call form, so the counters cannot
// be forgotten.
//
// `report` depends on `metric`, `tally`, `audit`, `ledger` and `note`, each
// partitioned per owner and each fetched in a different shape (see the extension).
// Read via `x-cache-status` on a scoped-purge redis instance:
//
//   - the report is served from cache at all: the counters of five collections the
//     host never captured were handed over, else the response is left uncached
//     (`unguarded_scope`).
//   - a create in any depended-on slice (owner=acme), whatever shape fetched it,
//     invalidates the cached report → MISS.
//   - a create in a sibling slice (owner=globex) does not, whatever shape → HIT.
//   - the resolved lookups come back through `dependOn`: the hook writes their
//     sizes, and the rejected sibling's verdict, onto the response.
//   - the counters folded are the ones each lookup took BEFORE its query, and two
//     lookups of one collection are judged on the earlier: a read that writes to
//     metric between two lookups of it, folded later-first, is refused by the fill
//     and never served again, while the next read caches normally.

const REPORT = 'test_items_depend_report';
const METRIC = 'test_items_depend_metric';
const AUDIT = 'test_items_depend_audit';
const LEDGER = 'test_items_depend_ledger';
const NOTE = 'test_items_depend_note';
const TALLY = 'test_items_depend_tally';
const DEPENDENCIES = [METRIC, TALLY, AUDIT, LEDGER, NOTE];

const SHAPES: [string, string][] = [
	['a pending lookup', METRIC],
	['an already-awaited lookup', TALLY],
	['the first entry of a Promise.all batch', AUDIT],
	['the second entry of a Promise.all batch', LEDGER],
	['a fulfilled Promise.allSettled verdict', NOTE],
];

const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	read-hook dependOn: the lookups a hook ran, in whatever shape it awaited them,
	scope the read to their slices with their counters
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-read-depend-on-${vendor}`;

		let instance: ChildProcess;

		beforeAll(async () => {
			// Seed on the default instance BEFORE the scoped instance spawns, so it sees
			// the collections (+ their `scoped_cache_fields`) on boot. Each dependency is
			// partitioned per owner; report carries no scope of its own.
			await CreateCollections(vendor, {
				collections: [
					...DEPENDENCIES.map((collection) => ({
						collection,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [
							{ field: 'owner', type: 'string', meta: {} },
							{ field: 'amount', type: 'string', meta: {} },
						],
					})),
					{
						collection: REPORT,
						fields: [
							{ field: 'name', type: 'string', meta: {} },
							{ field: 'slot', type: 'string', meta: {} },
						],
					},
				],
			});

			await Promise.all([
				...DEPENDENCIES.map((collection) =>
					CreateItem(vendor, {
						collection,
						item: [
							{ owner: 'acme', amount: '10' },
							{ owner: 'globex', amount: '20' },
						],
					}),
				),
				CreateItem(vendor, {
					collection: REPORT,
					item: [
						{ name: 'summary', slot: 'plain' },
						{ name: 'raced', slot: 'race' },
					],
				}),
			]);

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

			await Promise.all(
				[...DEPENDENCIES, REPORT].map((collection) =>
					DeleteCollection(vendor, { collection }),
				),
			);
		});

		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		function readReport(slot = 'plain') {
			return request(getUrl(vendor, env))
				.get(`/items/${REPORT}`)
				.query({ filter: { slot: { _eq: slot } } })
				.set('Authorization', auth);
		}

		function createIn(collection: string, owner: string) {
			return request(getUrl(vendor, env))
				.post(`/items/${collection}`)
				.send({ owner, amount: '99' })
				.set('Authorization', auth);
		}

		// Fill, then prove the entry is cached: a HIT is only possible when every
		// depended-on collection came with its counter.
		async function warmReport() {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const miss = await readReport();
			const hit = await readReport();

			expect(miss.headers[cacheStatusHeader]).toBe('MISS');
			expect(hit.headers[cacheStatusHeader]).toBe('HIT');

			return hit;
		}

		it(oneLine`
			hands each lookup back resolved — the hook reports the rows of every shape,
			and the rejected sibling's verdict, on the cached response
		`, async () => {
			const hit = await warmReport();

			expect(hit.body.data).toEqual([
				expect.objectContaining({
					name: 'summary',
					metric_count: 1,
					tally_count: 1,
					audit_count: 1,
					ledger_count: 1,
					note_count: 1,
					sibling_verdict: 'rejected',
				}),
			]);
		});

		it.each(SHAPES)(oneLine`
			a create in the slice %s fetched invalidates the cached report
		`, async (_shape, collection) => {
			await warmReport();

			await createIn(collection, 'acme');

			expect((await readReport()).headers[cacheStatusHeader]).toBe('MISS');
		});

		it.each(SHAPES)(oneLine`
			a create in the sibling slice of %s does not invalidate the report — it
			depends on the acme slices only
		`, async (_shape, collection) => {
			await warmReport();

			await createIn(collection, 'globex');

			expect((await readReport()).headers[cacheStatusHeader]).toBe('HIT');
		});

		it(oneLine`
			refuses to cache a read whose own write landed between two lookups of one
			collection, folded later-first — the counters are each lookup's pre-query
			capture, judged on the earlier
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			// The raced read: its payload holds the pre-write metric count, and the
			// write it made moved metric's counter after the first lookup captured it.
			const raced = await readReport('race');
			const again = await readReport('race');

			expect(raced.headers[cacheStatusHeader]).toBe('MISS');
			expect(again.headers[cacheStatusHeader]).toBe('MISS');

			expect(again.body.data[0].metric_count)
				.toBe(raced.body.data[0].metric_count + 1);

			// Not permanently uncacheable: the race fired once, the next fill stands.
			expect((await readReport('race')).headers[cacheStatusHeader]).toBe('HIT');
		});
	});
});
