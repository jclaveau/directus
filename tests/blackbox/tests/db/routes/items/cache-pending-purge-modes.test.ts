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
import knex, { type Knex } from 'knex';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// A purge that failed after its mutation committed is recorded, and the retry
// dispatches on the mode it was recorded under: `namespace` clears the store,
// `collection` re-runs the collection scan, `tags` drops the named keys. The
// existing recovery spec drives the recording end — an outage — and only ever
// produces the tags mode, so the two coarse branches are reached by nothing.
//
// Seeded straight into the table rather than provoked, because what needs
// covering is the retry's dispatch, not the failure that wrote the row: an
// outage wide enough to record a namespace purge is a different (and much
// slower) test than asserting what happens to the row once it exists.
//
// `namespace` mode is deliberately NOT driven from here, and must not be. The
// table carries no namespace column and the drain reads it unfiltered, so a
// namespace-mode row is picked up by whichever instance drains next — every
// Directus process on this database, and the shard runs several. It answers by
// clearing ITS OWN store, which silently satisfies a sibling spec's "MISS proves
// the purge ran" with a flush that spec never asked for. The dispatch itself is
// covered where nothing can be collateral: `scoped-cache.test.ts` drives it over
// a mocked table.
//
// Every row seeded below names this spec's own collection (or is the null-
// collection shape nothing else writes), so a sibling that drains one scans a
// collection it does not have and changes nothing. For the same reason the
// deletes and the row assertions are scoped to those shapes rather than taking
// the table wholesale.
//
// The third case is the one worth having. `collection` mode names a scan, and
// the column is nullable, so a row can exist that nothing can run. Dropping it
// would silently discard a record whose entries are still stale, so it has to be
// KEPT and counted instead — a row that survives its own retry is the assertion.

const SLICED = 'pending_purge_sliced';
const SIBLING = 'pending_purge_sibling';
const PENDING = 'directus_scoped_cache_pending_purges';
const cacheStatusHeader = 'x-cache-status';

describe(oneLine`
	a recorded purge is retried under the mode it was recorded with, and one naming
	no collection is kept rather than dropped
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
		env[vendor]['CACHE_NAMESPACE'] = `directus-pending-modes-${vendor}`;

		// The trigger. Without it the drain runs on reconnect only, and nothing here
		// takes Redis away.
		env[vendor]['CACHE_SCOPED_PURGE_RETRY_INTERVAL'] = '2s';

		let instance: ChildProcess;
		let db: Knex;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [
					{
						collection: SLICED,
						meta: { scoped_cache_fields: ['owner'] },
						fields: [
							{ field: 'label', type: 'string', meta: {} },
							{ field: 'owner', type: 'string', meta: {} },
						],
					},
					{
						collection: SIBLING,
						fields: [{ field: 'label', type: 'string', meta: {} }],
					},
				],
			});

			await Promise.all([
				CreateItem(vendor, {
					collection: SLICED,
					item: [
						{ label: 'a1', owner: 'a' },
						{ label: 'b1', owner: 'b' },
					],
				}),
				CreateItem(vendor, {
					collection: SIBLING,
					item: [{ label: 'untouched' }],
				}),
			]);

			const port = await getPort();
			env[vendor].PORT = String(port);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			db = knex(config.knexConfig[vendor]!);

			await awaitDirectusConnection(port);
		}, 60_000);

		afterAll(async () => {
			instance?.kill();

			await ownRows().delete();
			await db.destroy();

			await DeleteCollection(vendor, { collection: SLICED });
			await DeleteCollection(vendor, { collection: SIBLING });
		});

		function clearCache() {
			return request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);
		}

		function readSlice(owner: string) {
			return request(getUrl(vendor, env))
				.get(`/items/${SLICED}`)
				.query({ 'filter[owner][_eq]': owner })
				.set('Authorization', auth);
		}

		function readSibling() {
			return request(getUrl(vendor, env))
				.get(`/items/${SIBLING}`)
				.set('Authorization', auth);
		}

		async function fill(read: () => request.Test) {
			expect((await read()).headers[cacheStatusHeader]).toBe('MISS');
			expect((await read()).headers[cacheStatusHeader]).toBe('HIT');
		}

		function record(row: {
			mode: string;
			collection: string | null;
			scoped_cache_tag?: string | null;
		}) {
			return db(PENDING).insert({
				failed_at: new Date(),
				mode: row.mode,
				collection: row.collection,
				scoped_cache_tag: row.scoped_cache_tag ?? null,
				attempts: 0,
				last_error: 'seeded by the pending-purge modes spec',
			});
		}

		// The drain runs on its own timer, so every assertion waits for the state it
		// expects rather than for a fixed number of ticks.
		async function until(
			predicate: () => Promise<boolean>,
			what: string,
		): Promise<void> {
			for (let attempt = 0; attempt < 30; attempt++) {
				if (await predicate()) {
					return;
				}

				await new Promise((resolve) => setTimeout(resolve, 1000));
			}

			throw new Error(`timed out waiting for ${what}`);
		}

		// The two shapes this spec seeds, and nothing else: a scan of its own
		// collection, and the null-collection row no mutation ever records. Every
		// read and delete goes through this, so a sibling's in-flight record is
		// neither counted here nor thrown away.
		function ownRows() {
			return db(PENDING)
				.where({ mode: 'collection', collection: SLICED })
				.orWhere((builder: Knex.QueryBuilder) => {
					builder.where({ mode: 'collection' }).whereNull('collection');
				});
		}

		function pendingRows() {
			return ownRows().select('id', 'mode', 'collection', 'attempts');
		}

		// Every Directus process pointed at this database drains the same table, and
		// the shard runs several of them, so the row seeded here can be finished by a
		// sibling spec's instance — which clears ITS namespace and then deletes the
		// record this one is waiting on. So the wait is on the purge this instance
		// can observe, and a record that vanished without producing it is seeded
		// again.
		async function untilDrained(
			row: { mode: string; collection: string | null },
			purged: () => Promise<boolean>,
			what: string,
		): Promise<void> {
			await record(row);

			await until(async () => {
				if (await purged()) {
					return true;
				}

				if ((await pendingRows()).length === 0) {
					await record(row);
				}

				return false;
			}, what);
		}

		it(oneLine`
			finishes a collection-mode record by scanning that collection alone, so a
			sibling collection's entry survives it
		`, async () => {
			await clearCache();
			await ownRows().delete();

			await fill(() => readSlice('a'));
			await fill(() => readSlice('b'));
			await fill(readSibling);

			await untilDrained(
				{ mode: 'collection', collection: SLICED },
				async () => {
					const read = await readSlice('a');
					return read.headers[cacheStatusHeader] === 'MISS';
				},
				'the collection record to purge this instance\'s slices',
			);

			expect((await readSlice('b')).headers[cacheStatusHeader]).toBe('MISS');
			expect((await readSibling()).headers[cacheStatusHeader]).toBe('HIT');
		}, 60_000);

		it(oneLine`
			keeps a collection-mode record naming no collection, counting the attempt
			instead of discarding entries nothing else will drop
		`, async () => {
			await clearCache();
			await ownRows().delete();

			await record({ mode: 'collection', collection: null });

			await until(
				async () => {
					const [row] = await pendingRows();
					return (row?.attempts ?? 0) > 0;
				},
				'the unrunnable record to be counted',
			);

			const rows = await pendingRows();

			expect(rows).toHaveLength(1);
			expect(rows[0].collection).toBe(null);

			const [{ last_error: lastError }] = await ownRows()
				.select('last_error');

			expect(String(lastError)).toMatch(/names no collection/);
		}, 60_000);
	});
});
