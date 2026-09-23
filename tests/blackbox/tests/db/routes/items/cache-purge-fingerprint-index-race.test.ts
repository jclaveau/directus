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

// A slice purge reads the index sets its rows name in pages (SSCAN), tests every
// member's fingerprint, and SREMs the ones it matched — it never deletes a set. So a
// read filing its own member into one of those sets mid-pass is either scanned and
// purged, or missed and left indexed; it cannot come out of the pass holding data no
// later purge can reach. The sweep this replaced could: it SUNIONed the tag sets,
// deleted the entries they named, and only then DELETED THE SETS, so a fill landing
// between those two steps kept its entry and lost its index for the rest of its TTL
// — and the counter guard cannot help, because the read captured AFTER the bump and
// is right to cache.
//
// The pass is as long as the set is wide, which is why this inflates the index set
// first: every member costs a parse and a compare, so ~120k of them take long enough
// to aim a read at. The cache-purge-fingerprint-index-race hook does the aiming — it
// holds a read between its query and the fill that files its fingerprint.

const COLLECTION = 'purge_fingerprint_index_race';
const HELD_SLOT = 'window';
const REDIS_PORT = 6108;
const cacheStatusHeader = 'x-cache-status';

// Enough members that the purge's pass over the set is hundreds of ms. Planted
// straight into it, in the set's own grammar: a member naming a slice no write
// touches is read and compared like any other, and reading it is the cost this
// needs.
const decoyMemberCount = 120_000;
const decoyChunkSize = 4_000;

// How long the hook holds a read after its query. Its fill lands this far after the
// request arrives, so a read fired once the purge is under way files its fingerprint
// while the pass is still running.
const readHoldMs = 400;

// Reads fired at staggered offsets into the purge, so one of them files its
// fingerprint mid-pass wherever the runner's real pass happens to start and end.
// They start late enough that the counters were already bumped — a read that
// captured before the bump is undone by the guard and never reaches the assertion
// anyway. Each carries a distinct `limit`, so each is its own cache entry rather
// than overwriting the last.
const readLeadsMs = [300, 500, 700, 900, 1100];

const startedAt = Date.now();

function mark(phase: string) {
	// eslint-disable-next-line no-console
	console.info(`[fingerprint-index-race] ${Date.now() - startedAt}ms ${phase}`);
}

describe(oneLine`
	an entry filed into an index set while a purge is reading that set stays reachable
	to the next purge
`, () => {
	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		const namespace = `directus-fingerprint-index-race-${vendor}`;
		env[vendor]['CACHE_ENABLED'] = 'true';
		env[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
		env[vendor]['CACHE_AUTO_PURGE'] = 'true';
		env[vendor]['CACHE_AUTO_PURGE_MODE'] = 'scoped';
		env[vendor]['CACHE_STORE'] = 'redis';
		env[vendor]['REDIS_HOST'] = 'localhost';
		env[vendor]['REDIS_PORT'] = String(REDIS_PORT);
		env[vendor]['CACHE_NAMESPACE'] = namespace;
		env[vendor]['CACHE_RACE_READ_HOLD_MS'] = String(readHoldMs);

		// These two instances have no business finishing anyone else's failed purges.
		// The pending-purge table is shared by every instance in the shard while the
		// labels in it are namespace-free, so a drain here would rebuild them against
		// THIS namespace, purge nothing, and clear records that belong to the test
		// next door — which is one candidate for the retry-timer test failing beside
		// this one. Nothing in here ever records a pending purge, so it loses nothing.
		env[vendor]['CACHE_SCOPED_PURGE_RETRY_INTERVAL'] = '0';

		// The instance that purges, and the one that reads while it does. Same Redis,
		// same database, separate event loops — which is the whole point.
		let sweeperInstance: ChildProcess;
		let readerInstance: ChildProcess;
		const readerEnv = cloneDeep(env);
		let rowId: string;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		// The set the held reads are filed in: the collection's index is split by its
		// one scope field, so every read pinning this slot shares this one.
		const heldIndexKey =
			`${namespace}:scoped-cache-index:fingerprint:${COLLECTION}:slot=${HELD_SLOT}`;

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

			await redisCommand(REDIS_PORT, ['DEL', heldIndexKey]).catch(() => '');

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
		 * The narrowest thing that has to stay true for any of this to witness
		 * anything: the purge has to still be reading the set when the aimed reads
		 * file their fingerprints. A faster runner, or a cheaper pass, ends it before
		 * the first lead lands — every entry is then filed after the pass, trivially
		 * reachable, and the assertions below pass without having tested the race. So
		 * the purge's own duration is asserted, not just measured.
		 */
		const purgeMustOutlastMs = readLeadsMs[0]! + readHoldMs;

		/**
		 * Run one purge with reads aimed into it, and answer with the limits those
		 * reads cached under. The purge is the write's own, over the held slice; the
		 * decoys are what make its pass over that slice's set long enough to aim at.
		 */
		async function fillDuringPurge(label: string): Promise<number[]> {
			for (let sent = 0; sent < decoyMemberCount; sent += decoyChunkSize) {
				await redisCommand(REDIS_PORT, ['SADD', heldIndexKey, ...Array.from(
					{ length: Math.min(decoyChunkSize, decoyMemberCount - sent) },
					(_unused, index) => {
						return `${COLLECTION}:&slot=,decoy-${sent + index},&`
							+ `|fingerprint-index-race-decoy:${sent + index}`;
					},
				)]);
			}

			mark(`decoys planted (${decoyMemberCount})`);

			const held = readLeadsMs.map(async (lead, index) => {
				await new Promise((resolve) => setTimeout(resolve, lead));

				// Fired after the purge bumped the counters, so the guard has nothing
				// to object to: this read is entitled to cache what it fetched.
				const response = await readHeld(index + 1);
				expect(response.headers[cacheStatusHeader]).toBe('MISS');

				return index + 1;
			});

			const purgeStartedAt = Date.now();

			const [purgeResponse, limits] = await Promise.all([
				writeHeldLabel(label),
				Promise.all(held),
			]);

			const purgeMs = Date.now() - purgeStartedAt;

			expect(purgeResponse.status).toBe(200);
			mark(`purge answered in ${purgeMs}ms, ${limits.length} reads filled`);

			// Not a timing tolerance — a calibration check. Below this the decoys are
			// no longer buying a pass the reads can be aimed into, and a green says
			// nothing about the race. Raise `decoyMemberCount` if this ever trips.
			expect(purgeMs).toBeGreaterThan(purgeMustOutlastMs);

			return limits;
		}

		/**
		 * Which of the reads fired into the purge actually left an entry behind.
		 *
		 * A read whose fingerprint was filed into the set before the pass reached that
		 * page is purged by it and is a miss now — correctly, and it proves nothing
		 * either way. What the assertions below are about is the rest: entries that
		 * outlived the purge, and so must be reachable to the next one. At least one
		 * has to exist, or the aim missed entirely and a green would be vacuous.
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
			the next purge of the same slice reaches every entry filed during the first
			one, rather than leaving one indexed by a set that purge dropped
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const limits = await survivorsOf(await fillDuringPurge('v2'));

			mark(`${limits.length} entries survived the purge and are cached`);

			expect((await writeHeldLabel('v3')).status).toBe(200);

			const served = await Promise.all(limits.map((limit) => readHeld(limit)));

			mark(`after the second purge: ${
				served.map((r) => r.headers[cacheStatusHeader]).join(',')
			}`);

			// A HIT here is an entry the second purge could not see, because the first
			// one dropped the index set it had just been filed into.
			expect(served.map((response) => response.headers[cacheStatusHeader]))
				.toEqual(limits.map(() => 'MISS'));

			expect(served.map((response) => response.body.data[0].label))
				.toEqual(limits.map(() => 'v3'));
		}, 120_000);

		it(oneLine`
			a collection-wide purge reaches them too — it scans for the collection's
			index sets rather than being handed the one a row names
		`, async () => {
			await request(getUrl(vendor, env))
				.post('/utils/cache/clear')
				.set('Authorization', auth);

			const limits = await survivorsOf(await fillDuringPurge('v4'));

			// A create purges the bare tag, the new row's own slice and its key — never
			// the held slice. The hook it carries raises the collection-wide sweep, so
			// that is the only thing here that can reach these entries, and it reaches
			// them only if the set they were filed in is still there to be scanned.
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
