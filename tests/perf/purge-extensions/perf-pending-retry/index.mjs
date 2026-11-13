import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';

/**
 * Records failed purges and runs the drain that retries them, timed in-process:
 * the pending-retry bench measures what a retry costs as the record grows, and
 * the drain otherwise runs on a timer or a reconnect nothing can time.
 *
 * Imported from the api the running server loaded, for the reason
 * `perf-cache-fill` is: a copy resolved from here would drain with its own Redis
 * clients.
 */
const requireFromServer = createRequire(process.argv[1]);
const apiDist = dirname(requireFromServer.resolve('@directus/api'));

function importFromApi(path) {
	return import(pathToFileURL(join(apiDist, path)).href);
}

const [
	{ retryPendingScopedCachePurges },
	{ renderScopedCacheFingerprint, scopedCacheFingerprintOf },
] = await Promise.all([
	importFromApi('scoped-cache/purge.js'),
	importFromApi('scoped-cache/fingerprint.js'),
]);

const PENDING = 'directus_scoped_cache_pending_purges';

/**
 * `POST /perf-pending-retry/record` with `{ collection, ids }` records what a
 * write of those rows records when its purge fails: the bare fingerprint and one
 * per primary key, one row each. With `{ collection, mode: 'collection' }`, the
 * one row a collection-wide purge records.
 *
 * `POST /perf-pending-retry/drain` runs one drain and answers how long it took,
 * the longest the event loop was held meanwhile, and how many rows it cleared.
 */
export default function registerEndpoint(router, { database }) {
	router.post('/record', async (request, response, next) => {
		try {
			if (!request.accountability?.admin) {
				return response.status(403).json({ errors: [{ message: 'admin only' }] });
			}

			const { collection, ids = [], mode = 'slices' } = request.body;

			const fingerprints = mode === 'collection'
				? [null]
				: [
					scopedCacheFingerprintOf(collection, []),
					...ids.map((id) => {
						return scopedCacheFingerprintOf(collection, [
							{ field: 'id', value: id, type: 'integer' },
						]);
					}),
				].map(renderScopedCacheFingerprint);

			// One row for the write, as a failed purge records it.
			await database(PENDING).insert({
				failed_at: new Date(),
				mode,
				collection,
				scoped_cache_fingerprints: mode === 'collection'
					? null
					: JSON.stringify(fingerprints),
				attempts: 0,
				last_error: 'seeded by the pending-retry bench',
			});

			return response.json({ recorded: fingerprints.length });
		}
		catch (error) {
			return next(error);
		}
	});

	router.post('/drain', async (request, response, next) => {
		try {
			if (!request.accountability?.admin) {
				return response.status(403).json({ errors: [{ message: 'admin only' }] });
			}

			const loopDelay = monitorEventLoopDelay({ resolution: 1 });
			loopDelay.enable();

			const startedAt = performance.now();
			const cleared = await retryPendingScopedCachePurges();
			const drainMs = performance.now() - startedAt;

			loopDelay.disable();

			const [{ left }] = await database(PENDING).count({ left: '*' });

			return response.json({
				cleared,
				left: Number(left),
				drainMs,
				maxLoopBlockMs: loopDelay.max / 1e6,
			});
		}
		catch (error) {
			return next(error);
		}
	});
}
