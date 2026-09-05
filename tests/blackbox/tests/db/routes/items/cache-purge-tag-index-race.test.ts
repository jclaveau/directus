import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { redisCommand } from '@utils/redis-command';
import { oneLine } from '@directus/utils';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

// The sweep is three steps and no two of them are atomic: SUNION the tag sets,
// delete delete
// the entries they name, DEL the sets (then SREM them from the collection's slice
// index). A read that files its own key into one of those sets in between has the
// set set
// deleted underneath it: its entry stays in Redis, holding correct data, indexed by
// nothing. No later purge can reach it, so it serves that data for the rest of its
// TTL — and the counter guard cannot help, because the read captured AFTER the bump
// and is right to cache.
//
// The window is two adjacent Redis commands wide, which is why this inflates the tag
// set first: the per-member delete phase between them is O(members) of client work,
// so a set of ~120k names takes long enough to aim a read at. The
// cache-purge-tag-index-race hook does the aiming — it holds a read between its
// query query
// and the fill that files its tags.

const COLLECTION = 'purge_tag_index_race';
const HELD_SLOT = 'window';
const REDIS_PORT = 6108;
const cacheStatusHeader = 'x-cache-status';

// Enough members that the delete phase between SUNION and DEL is hundreds of ms.
// Planted straight into the set: they name nothing, and deleting a key that does not
// exist costs the sweep the same client-side work as one that does — which is the
// cost this needs.
const decoyMemberCount = 120_000;
const decoyChunkSize = 4_000;

// How long the hook holds a read after its query. Its fill lands this far after the
// request arrives, so a read fired once the sweep is under way files its tags inside
// the window.
const readHoldMs = 400;

// Measured on a runner: the sweep answers ~1.8s after the decoys are planted, and
// its DEL is the last thing it does. Leads are spread across that, starting late
// enough that the counters were already bumped — a read that captured before the
// bump is undone by the guard and never reaches the assertion anyway.

// Reads fired at staggered offsets into the sweep, so one of them lands in the
// window window
// wherever the runner's real delete phase happens to start and end. Each carries a
// distinct `limit`, so each is its own cache entry rather than overwriting the last.
const readLeadsMs = [300, 500, 700, 900, 1100];

const startedAt = Date.now();

function mark(phase: string) {
	// eslint-disable-next-line no-console
	console.info(`[tag-index-race] ${Date.now() - startedAt}ms ${phase}`);
}

describe(oneLine`
	an entry filed while a sweep is between reading its tag sets and deleting them
	stays reachable to the next purge
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		const namespace = `directus-tag-index-race-${vendor}`;
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = String(REDIS_PORT);
		env[vendor]['CACHE_NAMESPACE'] = namespace;
		env[vendor]['CACHE_RACE_READ_HOLD_MS'] = String(readHoldMs);

		// The instance that sweeps, and the one that reads while it does. Same Redis,
		// same database, separate event loops — which is the whole point.
		let sweeperInstance: ChildProcess;
		let readerInstance: ChildProcess;
		const readerEnv = cloneDeep(env);
		let rowId: string;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;
		const heldSliceKey = `${namespace}:tag:${COLLECTION}:slot=${HELD_SLOT}`;

		beforeAll(async () => {
			await CreateCollections(vendor, {
				collections: [{
					collection: COLLECTION,
					meta: { scoped_cache_fields: ['slot'] },
					fields: [
						{ field: 'slot', type: 'string', meta: {} },
						{ field: 'label', type: 'string', meta: {} },
					],
				}],
			});

			await CreateItem(vendor, {
				collection: COLLECTION,
				item: [{ slot: HELD_SLOT, label: 'v1' }],
			});

			const port = await getPort();
			env[vendor].PORT = String(port);

			sweeperInstance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			const readerPort = await getPort();
			readerEnv[vendor].PORT = String(readerPort);

			readerInstance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: readerEnv[vendor],
			});

			await awaitDirectusConnection(port);
			await awaitDirectusConnection(readerPort);

			const seeded = await request(getUrl(vendor, env))
				.get(`/items/${COLLECTION}`)
				.query({ 'filter[slot][_eq]': HELD_SLOT })
				.set('Authorization', auth);

			rowId = seeded.body.data[0].id;
		}, 120_000);

		afterAll(async () => {
			sweeperInstance?.kill();
			readerInstance?.kill();

			await redisCommand(REDIS_PORT, ['DEL', heldSliceKey]).catch(() => '');

			await DeleteCollection(vendor, { collection: COLLECTION });
		});

		function readHeld(limit: number) {
			return request(getUrl(vendor, readerEnv))
				.get(`/items/${COLLECTION}`)
				.query({ 'filter[slot][_eq]': HELD_SLOT, limit })
				.set('Authorization', auth);
		}

		function writeHeldLabel(label: string) {
			return request(getUrl(vendor, env))
				.patch(`/items/${COLLECTION}/${rowId}`)
				.send({ label })
				.set('Authorization', auth);
		}

		/**
		 * Run one sweep with reads aimed into it, and answer with the cache keys those
		 * reads filled. The sweep is the write's own purge of the held slice; the
		 * decoys are what make its delete phase long enough to aim at.
		 */
		async function fillDuringSweep(label: string): Promise<number[]> {
			for (let sent = 0; sent < decoyMemberCount; sent += decoyChunkSize) {
				await redisCommand(REDIS_PORT, ['SADD', heldSliceKey, ...Array.from(
					{ length: Math.min(decoyChunkSize, decoyMemberCount - sent) },
					(_unused, index) => `tag-index-race-decoy:${sent + index}`,
				)]);
			}

			mark(`decoys planted (${decoyMemberCount})`);

			const held = readLeadsMs.map(async (lead, index) => {
				await new Promise((resolve) => setTimeout(resolve, lead));

				// Fired after the sweep bumped the counters, so the guard has nothing
				// to object to: this read is entitled to cache what it fetched.
				const response = await readHeld(index + 1);
				expect(response.headers[cacheStatusHeader]).toBe('MISS');

				return index + 1;
			});

			const [sweepResponse, limits] = await Promise.all([
				writeHeldLabel(label),
				Promise.all(held),
			]);

			expect(sweepResponse.status).toBe(200);
			mark(`sweep answered, ${limits.length} reads filled during it`);

			return limits;
		}

		/**
		 * Which of the reads fired into the sweep actually left an entry behind.
		 *
		 * A read whose tags were filed BEFORE the sweep read its sets is deleted by it
		 * and is a miss now — correctly, and it proves nothing either way. What the
		 * assertions below are about is the rest: entries that outlived the sweep, and
		 * so must be reachable to the next purge. At least one has to exist, or the
		 * aim missed entirely and a green would be vacuous.
		 */
		async function survivorsOf(limits: number[]): Promise<number[]> {
			const cached: number[] = [];

			for (const limit of limits) {
				const served = await readHeld(limit);

				if (served.headers[cacheStatusHeader] === 'HIT') {
					cached.push(limit);
				}
			}

			expect(cached.length).toBeGreaterThan(0);

			return cached;
		}

		it(oneLine`
			the next purge of the same slice reaches every entry filed during the sweep,
			rather than leaving one indexed by a set the sweep deleted
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const limits = await survivorsOf(await fillDuringSweep('v2'));

			mark(`${limits.length} entries survived the sweep and are cached`);

			expect((await writeHeldLabel('v3')).status).toBe(200);

			const served = await Promise.all(limits.map((limit) => readHeld(limit)));

			mark(`after the second purge: ${
				served.map((r) => r.headers[cacheStatusHeader]).join(',')
			}`);

			// A HIT here is an entry the second purge could not see, because the first
			// one deleted the tag set it had just been filed into.
			expect(served.map((response) => response.headers[cacheStatusHeader]))
				.toEqual(limits.map(() => 'MISS'));

			expect(served.map((response) => response.body.data[0].label))
				.toEqual(limits.map(() => 'v3'));
		}, 120_000);

		it(oneLine`
			a collection-wide purge reaches them too — it finds its work through the
			slice index, which the sweep prunes just as unatomically
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const limits = await survivorsOf(await fillDuringSweep('v4'));

			// A create purges the bare tag, the new row's own slice and its key — never
			// the held slice. The hook it carries raises the collection-wide sweep, so
			// that is the only thing here that can reach these entries, and it reaches
			// them only if the slice index still names their tag set.
			const created = await request(getUrl(vendor, env))
				.post(`/items/${COLLECTION}`)
				.send({ slot: 'elsewhere', label: 'sweep' })
				.set('Authorization', auth);

			expect(created.status).toBe(200);

			const served = await Promise.all(limits.map((limit) => readHeld(limit)));

			mark(`after the collection purge: ${
				served.map((r) => r.headers[cacheStatusHeader]).join(',')
			}`);

			expect(served.map((response) => response.headers[cacheStatusHeader]))
				.toEqual(limits.map(() => 'MISS'));
		}, 120_000);
	});
});
