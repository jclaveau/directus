import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Fills the response cache the way `GET /items/:collection` does, without the
 * request: the purge-scaling bench needs a hundred thousand entries, and paying
 * the HTTP stack for each one was most of the job.
 *
 * Every step is the api's own — the query sanitized, the read run, the cache key
 * built, the entry filed and written — in the order `respond.ts` runs them, so
 * each branch files with its own index layout. Keep it in step with that
 * middleware's fill.
 *
 * Imported from the api the running server loaded, not from this directory: a
 * copy resolved from here would be a second module graph, with its own Redis
 * clients and its own cache instance.
 */
const requireFromServer = createRequire(process.argv[1]);
const apiDist = dirname(requireFromServer.resolve('@directus/api'));

function importFromApi(path) {
	return import(pathToFileURL(join(apiDist, path)).href);
}

const [
	{ getCache, setCacheValue },
	{ resolvedCacheTtl },
	{ cacheExpiresAtKey },
	{ writeCacheTombstone },
	{ default: emitter },
	{ indexScopedCacheEntry },
	{ getCacheKey },
	{ getMilliseconds },
	{ readMeta },
	{ sanitizeQuery },
] = await Promise.all([
	importFromApi('cache.js'),
	importFromApi('cache-config.js'),
	importFromApi('cache-sidecars.js'),
	importFromApi('cache-events.js'),
	importFromApi('emitter.js'),
	importFromApi('scoped-cache/index.js'),
	importFromApi('utils/get-cache-key.js'),
	importFromApi('utils/get-milliseconds.js'),
	importFromApi('utils/read-meta.js'),
	importFromApi('utils/sanitize-query.js'),
]);

/**
 * The query `GET` receives for `?filter[pk][_eq]=…<sharedFilter>&limit=…
 * &fields=…`, the shared filter's fields after the key as the bench's path
 * lists them.
 */
function rawReadQuery(primaryKeyField, rowId, limit, fields, sharedFilter) {
	return {
		fields,
		filter: { [primaryKeyField]: { _eq: String(rowId) }, ...sharedFilter },
		limit: String(limit),
	};
}

async function fillEntry(request, fill) {
	const { cache } = getCache();

	const readQuery = await sanitizeQuery(
		fill.rawQuery,
		fill.schema,
		fill.accountability,
	);

	// Only what the key reads is swapped; the headers `accepts` negotiates on
	// are the filler's own request's, the same a bench GET sends.
	const keyedRequest = Object.create(request, {
		originalUrl: { value: fill.path },
		sanitizedQuery: { value: readQuery },
	});

	const { redisKey } = await getCacheKey(keyedRequest);
	const now = Date.now();
	const cacheTtl = resolvedCacheTtl();
	const ttlMs = getMilliseconds(cacheTtl);
	const expiresAt = now + getMilliseconds(cacheTtl, 0);

	await indexScopedCacheEntry(
		redisKey,
		fill.fingerprints,
		[],
		fill.schema,
		cacheTtl,
	);

	await emitter.emitAction('cache.indexed', {
		redisKey,
		fingerprints: fill.fingerprints,
	});

	await Promise.all([
		setCacheValue(cache, redisKey, fill.payload, ttlMs),
		cache.set(cacheExpiresAtKey(redisKey), {
			exp: expiresAt,
			createdAt: now,
			ttlMs: ttlMs ?? null,
		}, ttlMs),
	]);

	await writeCacheTombstone(redisKey, expiresAt);
}

/**
 * `POST /perf-cache-fill` with `{ collection, fields, filter, rows: [{ id,
 * limits }] }` caches `GET /items/<collection>?filter[<pk>][_eq]=<id><filter>
 * &limit=<limit>&fields=<fields>` for every limit of every row, as the admin
 * calling it. `filter` is optional, raw as a query string hands it over.
 */
export default function registerEndpoint(router, { services, getSchema }) {
	router.post('/', async (request, response, next) => {
		try {
			const { collection, fields, rows, filter: sharedFilter = {} } = request.body;
			const schema = request.schema ?? await getSchema();
			const accountability = request.accountability;
			const primaryKeyField = schema.collections[collection].primary;
			const path = `/items/${collection}`;

			const fillsByRow = await Promise.all(rows.map(async ({ id, limits }) => {
				// Read once per row: a primary-key `_eq` matches one row whatever the
				// limit, so every limit reads the same data under the same pins. The
				// key is still built from each entry's own query.
				const firstQuery = await sanitizeQuery(
					rawReadQuery(primaryKeyField, id, limits[0], fields, sharedFilter),
					schema,
					accountability,
				);

				const itemsService = new services.ItemsService(collection, {
					accountability,
					schema,
				});

				const metaService = new services.MetaService({ accountability, schema });
				const result = await itemsService.readByQuery(firstQuery);

				const payload = {
					meta: await metaService.getMetaForQuery(collection, firstQuery),
					data: result,
				};

				const fingerprints = readMeta(result)?.scopedCacheFingerprints ?? [];

				if (fingerprints.length === 0) {
					throw new Error(`the read of ${collection} ${id} pinned nothing`);
				}

				return limits.map((limit) => {
					return {
						rawQuery: rawReadQuery(
							primaryKeyField,
							id,
							limit,
							fields,
							sharedFilter,
						),
						path,
						schema,
						accountability,
						payload,
						fingerprints,
					};
				});
			}));

			const fills = fillsByRow.flat();

			await Promise.all(fills.map((fill) => fillEntry(request, fill)));

			response.json({ filled: fills.length });
		}
		catch (error) {
			next(error);
		}
	});
}
