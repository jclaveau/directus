import config, { getUrl, paths } from '@common/config';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { awaitRequestedReap } from '@utils/await-requested-reap';
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
// later purge can reach. The sweep this replaced could: it SUNIONed the index sets,
// deleted the entries they named, and only then DELETED THE SETS, so a fill landing
// between those two steps kept its entry and lost its index for the rest of its TTL
// — and the counter guard cannot help, because the read snapshotted AFTER the bump
// and is right to cache.
//
// A write's purge reads the bare set and the set its row's slot names together, a
// page of each per round trip, until both are read. So the inflated bare set is what
// keeps the pass running, while the held slot's set — empty when the pass starts —
// is read whole on its first page. Every read filed into it after that page is one
// this pass already went by: the window is the whole rest of the pass, not the luck
// of where SSCAN's cursor stands. The cache-purge-fingerprint-index-race hook holds
// a read between its query and the fill that files its fingerprint.

const COLLECTION = 'purge_fingerprint_index_race';
const HELD_SLOT = 'window';
const REDIS_PORT = 6108;
const cacheStatusHeader = 'x-cache-status';

// Enough members that the purge's pass over the set is seconds. Planted straight
// into it, in the set's own grammar: a member naming a slice no write touches is
// read and compared like any other, and reading it is the cost this needs.
const decoyMemberCount = 120_000;
const decoyChunkSize = 4_000;

// How long the hook holds a read after its query. Its fill lands this far after the
// request arrives, so a read fired once the purge is under way files its fingerprint
// while the pass is still running.
const readHoldMs = 400;

// Reads fired after the purge bumps its counter, which it does right before its
// pass. Each carries a distinct `limit`, so each is its own cache entry rather than
// overwriting the last.
const readLeadsMs = [100, 200, 300, 400, 500];

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

		// The reader boots second, under a build the sweeper did not record, as a
		// node of a rolling deploy does: its boot flush asks for a reap of its own,
		// which runs about a second later — over the decoys, while the first purge
		// is under way, unless the test waits it out first.
		const buildId = `fingerprint-index-race-${Date.now()}`;
		env[vendor]['CACHE_BUILD_ID'] = `${buildId}-sweeper`;
		readerEnv[vendor]['CACHE_BUILD_ID'] = `${buildId}-reader`;
		let rowId: string;
		const auth = `Bearer ${USER.ADMIN.TOKEN}`;

		// The set the held reads are filed in: the collection's index is split by its
		// one scope field, so every read pinning this slot shares this one.
		const heldIndexKey =
			`${namespace}:scoped-cache-index:fingerprint:${COLLECTION}:slot=${HELD_SLOT}`;

		// The set of the reads that pin nothing, which every write's purge reads.
		const bareIndexKey =
			`${namespace}:scoped-cache-index:fingerprint:${COLLECTION}:`;

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

			await awaitDirectusConnection(port);

			const seeded = await request(getUrl(vendor, env))
				.get(`/items/${COLLECTION}`)
				.query({ 'filter[slot][_eq]': HELD_SLOT })
				.set('Authorization', auth);

			rowId = seeded.body.data[0].id;

			const readerPort = await getPort();
			readerEnv[vendor].PORT = String(readerPort);

			readerInstance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: readerEnv[vendor],
			});

			await awaitDirectusConnection(readerPort);
		}, 120_000);

		afterAll(async () => {
			sweeperInstance?.kill();
			readerInstance?.kill();

			await redisCommand(REDIS_PORT, ['DEL', heldIndexKey, bareIndexKey])
				.catch(() => '');

			await DeleteCollection(vendor, { collection: COLLECTION });
		});

		function readHeld(limit: number) {
			return request(getUrl(vendor, readerEnv))
				.get(`/items/${COLLECTION}`)
				.query({ 'filter[slot][_eq]': HELD_SLOT, limit })
				.set('Authorization', auth);
		}

		/**
		 * Clear through both instances, each answering once its own reaps are over.
		 * A reap still to come in either one would walk the decoys during the purge
		 * and move the counter the held reads check — the reader's boot flush asks
		 * for one, and the sweeper's pass alone does not wait it out. Sequential, so
		 * the reap each clear asks of the other finds the index already marked.
		 */
		async function clearAwaitingEveryReap() {
			await awaitRequestedReap(REDIS_PORT, namespace, async () => {
				for (const instanceEnv of [env, readerEnv]) {
					await request(getUrl(vendor, instanceEnv))
						.post('/utils/cache/clear')
						.set('Authorization', auth);
				}
			});
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
		 * the last lead lands — that entry is then filed after the pass, trivially
		 * reachable, and the assertions below pass without having tested the race. So
		 * the purge's own duration is asserted, not just measured.
		 */
		const purgeMustOutlastMs = readLeadsMs.at(-1)! + readHoldMs;

		const purgeCounterKey = `${namespace}:scoped-cache-epoch:${COLLECTION}`;

		function readPurgeCounter() {
			return redisCommand(REDIS_PORT, [
				'EVAL',
				"return tonumber(redis.call('GET', KEYS[1]) or '0')",
				'1',
				purgeCounterKey,
			]);
		}

		async function plantDecoys(decoyIndexKey: string) {
			for (let sent = 0; sent < decoyMemberCount; sent += decoyChunkSize) {
				await redisCommand(REDIS_PORT, ['SADD', decoyIndexKey, ...Array.from(
					{ length: Math.min(decoyChunkSize, decoyMemberCount - sent) },
					(_unused, index) => {
						return `${COLLECTION}:&slot=,decoy-${sent + index},&`
							+ `|fingerprint-index-race-decoy:${sent + index}`;
					},
				)]);
			}

			// Filing registers every set it writes, and a purge trusting a complete
			// registry reaches only the sets named there.
			await redisCommand(REDIS_PORT, [
				'SADD',
				`${namespace}:scoped-cache-index:collection-index-keys:${COLLECTION}`,
				decoyIndexKey,
			]);

			mark(`decoys planted (${decoyMemberCount})`);
		}

		/**
		 * Run one purge with reads aimed into it, and answer with the limits those
		 * reads cached under. The purge is the write's own, over the held slice; the
		 * decoys in the bare set it reads beside that slice's are what keep its pass
		 * running once that slice's set is read.
		 */
		async function fillDuringPurge(label: string): Promise<number[]> {
			await plantDecoys(bareIndexKey);

			const counterBefore = await readPurgeCounter();
			let purgeStartedAt = 0;
			let purgeEndedAt = 0;

			// The write is listed first so it is sent first: a supertest request goes
			// out once `then` is called. Its end is timed apart from the reads, the
			// last of which starts well after a short pass would be over.
			const [purgeResponse, limits] = await Promise.all([
				writeHeldLabel(label).then((response) => {
					purgeEndedAt = Date.now();

					return response;
				}),
				(async () => {
					const writeSentAt = Date.now();

					while (
						await readPurgeCounter() === counterBefore
						&& Date.now() - writeSentAt < 30_000
					) {
						await new Promise((resolve) => setTimeout(resolve, 10));
					}

					purgeStartedAt = Date.now();
					mark(`counter moved after ${purgeStartedAt - writeSentAt}ms`);

					return Promise.all(readLeadsMs.map(async (lead, index) => {
						await new Promise((resolve) => setTimeout(resolve, lead));

						// Fired after the purge bumped the counters, so the guard has
						// nothing to object to: this read may cache what it fetched.
						const response = await readHeld(index + 1);
						expect(response.headers[cacheStatusHeader]).toBe('MISS');

						return index + 1;
					}));
				})(),
			]);

			const purgeMs = purgeEndedAt - purgeStartedAt;

			expect(purgeResponse.status).toBe(200);
			mark(`purge ran ${purgeMs}ms past its counter, ${limits.length} reads filled`);

			// Not a timing tolerance — a calibration check. Below this the decoys are
			// no longer buying a pass the reads can be aimed into, and a green says
			// nothing about the race. Raise `decoyMemberCount` if this ever trips.
			expect(purgeMs).toBeGreaterThan(purgeMustOutlastMs);

			return limits;
		}

		function readEveryHeld(limits: number[]) {
			return Promise.all(limits.map((limit) => readHeld(limit)));
		}

		it(oneLine`
			the next purge of the same slice reaches every entry filed during the first
			one, rather than leaving one indexed by a set that purge dropped
		`, async () => {
			await clearAwaitingEveryReap();

			const limits = await fillDuringPurge('v2');

			// Every read filed after the pass read the held set, so the pass left each
			// one cached and indexed.
			const filled = await readEveryHeld(limits);

			expect(filled.map((response) => response.headers[cacheStatusHeader]))
				.toEqual(['HIT', 'HIT', 'HIT', 'HIT', 'HIT']);

			expect((await writeHeldLabel('v3')).status).toBe(200);

			const served = await readEveryHeld(limits);

			mark(`after the second purge: ${
				served.map((r) => r.headers[cacheStatusHeader]).join(',')
			}`);

			// A HIT here is an entry the second purge could not see, because the first
			// one dropped the index set it had just been filed into.
			expect(served.map((response) => response.headers[cacheStatusHeader]))
				.toEqual(['MISS', 'MISS', 'MISS', 'MISS', 'MISS']);

			expect(served.map((response) => response.body.data[0].label))
				.toEqual(['v3', 'v3', 'v3', 'v3', 'v3']);
		}, 120_000);

		it(oneLine`
			a collection-wide purge reaches them too — it scans for the collection's
			index sets rather than being handed the one a row names
		`, async () => {
			await clearAwaitingEveryReap();

			const limits = await fillDuringPurge('v4');
			const filled = await readEveryHeld(limits);

			expect(filled.map((response) => response.headers[cacheStatusHeader]))
				.toEqual(['HIT', 'HIT', 'HIT', 'HIT', 'HIT']);

			// A create purges the bare pin, the new row's own slice and its key — never
			// the held slice. The hook it carries raises the collection-wide sweep, so
			// that is the only thing here that can reach these entries, and it reaches
			// them only if the set they were filed in is still there to be scanned.
			const created = await request(getUrl(vendor, env))
				.post(`/items/${COLLECTION}`)
				.send({ slot: 'elsewhere', label: 'sweep' })
				.set('Authorization', auth);

			expect(created.status).toBe(200);

			const served = await readEveryHeld(limits);

			mark(`after the collection purge: ${
				served.map((r) => r.headers[cacheStatusHeader]).join(',')
			}`);

			expect(served.map((response) => response.headers[cacheStatusHeader]))
				.toEqual(['MISS', 'MISS', 'MISS', 'MISS', 'MISS']);
		}, 120_000);

		it(oneLine`
			a collection-wide purge of a set holding 120k reads never holds Redis for
			10 ms, and leaves no index set behind
		`, async () => {
			await plantDecoys(heldIndexKey);

			// Redis's own clock rather than a probe's round trip, so a busy runner
			// cannot pass for a stall. The slowlog keeps every command slower than
			// 10 ms — set here, not trusted to the image's default, since a higher
			// threshold would pass this with nothing measured. Only the ones naming an
			// index set count, since the purge also drops the 120k cache keys the
			// decoys name.
			expect(await redisCommand(REDIS_PORT, [
				'CONFIG',
				'SET',
				'slowlog-log-slower-than',
				'10000',
			])).toBe('+OK');

			const lastSlowCommand = await redisCommand(REDIS_PORT, [
				'EVAL',
				"local last = redis.call('SLOWLOG', 'GET', 1)[1] "
				+ 'return last and last[1] or -1',
				'0',
			]);

			const created = await request(getUrl(vendor, env))
				.post(`/items/${COLLECTION}`)
				.send({ slot: 'elsewhere', label: 'sweep' })
				.set('Authorization', auth);

			expect(created.status).toBe(200);

			const slowIndexCommands = await redisCommand(REDIS_PORT, [
				'EVAL',
				"local count = 0 "
				+ "for _, entry in ipairs(redis.call('SLOWLOG', 'GET', 128)) do "
				+ 'if entry[1] > tonumber(ARGV[1]) then '
				+ 'for _, arg in ipairs(entry[4]) do '
				+ 'if string.find(arg, ARGV[2], 1, true) then '
				+ 'count = count + 1 break '
				+ 'end end end end '
				+ 'return count',
				'0',
				lastSlowCommand.slice(1),
				`${namespace}:scoped-cache-index:`,
			]);

			expect(slowIndexCommands).toBe(':0');
			expect(await redisCommand(REDIS_PORT, ['EXISTS', heldIndexKey])).toBe(':0');

			expect(await redisCommand(REDIS_PORT, [
				'EVAL',
				"return #redis.call('KEYS', ARGV[1])",
				'0',
				`${namespace}:scoped-cache-index:swept:*`,
			])).toBe(':0');
		}, 120_000);
	});
});
