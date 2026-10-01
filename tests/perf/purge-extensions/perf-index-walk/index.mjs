import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

/**
 * Files a collection's index straight through the store, and runs the purges
 * that walk it, timed in-process: the purge-walk bench measures what a
 * collection-wide purge costs per index set it walks, alone and with others of
 * the same collection running at once.
 *
 * Production's `student_course` index is about a thousand sets of entries pinned
 * to their row and to long lists beside it. A GET cannot pin a list that long,
 * so the fingerprints are built here and handed to the filing every fill goes
 * through.
 *
 * Imported from the api the running server loaded, for the reason
 * `perf-cache-fill` is: a copy resolved from here would purge with its own Redis
 * clients.
 */
const requireFromServer = createRequire(process.argv[1]);
const apiDist = dirname(requireFromServer.resolve('@directus/api'));

function importFromApi(path) {
	return import(pathToFileURL(join(apiDist, path)).href);
}

const [
	{ getCache, setCacheValue },
	{ indexScopedCacheEntry, purgeScopedCache, scopedCacheIndexPath },
] = await Promise.all([
	importFromApi('cache.js'),
	importFromApi('scoped-cache/index.js'),
]);

const FILING_CONCURRENCY = 256;
const ENTRY_TTL_MS = 6 * 60 * 60 * 1000;

// What a planner read of `student_course` selects.
const VIEW_FIELDS = [
	'id',
	'student',
	'course',
	'course_part',
	'status',
	'enabled',
	'date_created',
	'date_updated',
	'user_created',
	'user_updated',
	'progress',
	'position',
	'started_at',
	'finished_at',
	'label',
];

function valueList(seed, length) {
	return Array.from({ length }, (_, at) => String(100000 + seed * 7 + at * 13));
}

/**
 * Entry `member` of set `set`: pinned to its row, as a home pin, and to the
 * lists a planner read carries beside it, about a kilobyte rendered.
 */
function walkFingerprint(collection, set, member) {
	return {
		collection,
		pinnedScope: {
			id: [String(1_000_000 + set)],
			student: valueList(set + member, 60),
			course_part: valueList(set, 20),
			status: ['active', 'pending'],
		},
		viewFields: VIEW_FIELDS,
	};
}

function walkKey(collection, set, member) {
	return createHash('sha1')
		.update(`${collection}:${set}:${member}`)
		.digest('hex');
}

async function inBatches(count, run) {
	for (let at = 0; at < count; at += FILING_CONCURRENCY) {
		const batch = Array.from(
			{ length: Math.min(FILING_CONCURRENCY, count - at) },
			(_, offset) => run(at + offset),
		);

		await Promise.all(batch);
	}
}

/**
 * `kind: 'collection'` is what `purgeForMutatedRows` runs for a sort; `kind:
 * 'declared'` is a hook's `purgeBy` on a field the index is not split by, which
 * reads every set of the collection the same way.
 */
function runPurge(cache, collection, kind, indexPath) {
	if (kind === 'collection') {
		return purgeScopedCache(cache, collection, null);
	}

	return purgeScopedCache(cache, collection, [], null, {
		includeBareFingerprint: false,
		indexPath,
		declaredFingerprints: [
			{ collection, pinnedScope: { course_part: ['-1'] } },
		],
	});
}

/**
 * `POST /perf-index-walk/seed` with `{ collection, sets, members }` caches
 * `members` entries under each of `sets` sets, the entry written beside its
 * filing.
 *
 * `POST /perf-index-walk/purge` with `{ collection, kind, concurrent }` starts
 * `concurrent` purges of the collection at once, and answers how long each
 * took, the CPU the process spent meanwhile and the longest the event loop was
 * held.
 */
export default function registerEndpoint(router, { getSchema }) {
	router.use((request, response, next) => {
		if (!request.accountability?.admin) {
			return response.status(403).json({
				errors: [{ message: 'admin only' }],
			});
		}

		next();
	});

	router.post('/seed', async (request, response, next) => {
		try {
			const { collection, sets, members } = request.body;
			const schema = request.schema ?? await getSchema();
			const { cache } = getCache();

			await inBatches(sets * members, async (entryAt) => {
				const set = Math.floor(entryAt / members);
				const member = entryAt % members;
				const key = walkKey(collection, set, member);

				await indexScopedCacheEntry(
					key,
					[walkFingerprint(collection, set, member)],
					[],
					schema,
					ENTRY_TTL_MS,
				);

				await setCacheValue(cache, key, { data: [{ id: set }] }, ENTRY_TTL_MS);
			});

			response.json({ filed: sets * members });
		}
		catch (error) {
			next(error);
		}
	});

	router.post('/purge', async (request, response, next) => {
		try {
			const { collection, kind, concurrent } = request.body;
			const schema = request.schema ?? await getSchema();
			const indexPath = scopedCacheIndexPath(schema, collection);
			const { cache } = getCache();
			const loopDelay = monitorEventLoopDelay({ resolution: 5 });
			const cpuBefore = process.cpuUsage();
			const startedAt = performance.now();

			loopDelay.enable();

			const durationsMs = await Promise.all(
				Array.from({ length: concurrent }, async () => {
					const purgeStartedAt = performance.now();

					await runPurge(cache, collection, kind, indexPath);

					return performance.now() - purgeStartedAt;
				}),
			);

			loopDelay.disable();

			const cpu = process.cpuUsage(cpuBefore);

			response.json({
				durationsMs,
				wallMs: performance.now() - startedAt,
				cpuMs: (cpu.user + cpu.system) / 1000,
				maxLoopDelayMs: loopDelay.max / 1e6,
			});
		}
		catch (error) {
			next(error);
		}
	});
}
