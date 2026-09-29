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
	{ requestScopedCacheIndexReap },
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
	importFromApi('scoped-cache/reap-requests.js'),
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
	const cacheTtl = fill.ttlMs ?? resolvedCacheTtl();
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

	return redisKey;
}

/**
 * The names Redis holds an entry and its `__expires_at` sibling under: both
 * namespaces, the way `cache-drop.ts` builds them.
 */
function rawEntryKeys(redisKey) {
	const { cache } = getCache();

	return [redisKey, cacheExpiresAtKey(redisKey)].map((key) => {
		return cache.store.createKeyPrefix(
			`${cache.namespace}:${key}`,
			cache.store.namespace,
		);
	});
}

/**
 * `POST /perf-cache-fill` with `{ collection, fields, filter, rows: [{ id,
 * limits }] }` caches `GET /items/<collection>?filter[<pk>][_eq]=<id><filter>
 * &limit=<limit>&fields=<fields>` for every limit of every row, as the admin
 * calling it. `filter` is optional, raw as a query string hands it over.
 *
 * With `ttlMs`, the entries and their filing take that TTL instead of the
 * cache's, and the answer also names in Redis the call's first entry and its
 * sibling, for the caller to watch expire.
 */
export default function registerEndpoint(router, { services, getSchema, env }) {
	/**
	 * `POST /perf-cache-fill/reap` joins the reap a flush asks for, or asks for
	 * one, and answers once it has run: the bench turns the scheduled one off. It
	 * names in Redis the key marking the index-key sets complete and the
	 * generation it has to hold.
	 */
	router.post('/reap', async (request, response) => {
		if (!request.accountability?.admin) {
			return response.status(403).json({
				errors: [{ message: 'admin only' }],
			});
		}

		try {
			await requestScopedCacheIndexReap();

			return response.json({
				markerKey: `${env['CACHE_NAMESPACE']}:scoped-cache-index:`
					+ 'collection-index-keys-complete',
				generationKey:
					`${env['CACHE_NAMESPACE']}:scoped-cache-index-generation`,
			});
		}
		catch (error) {
			return response.status(500).json({ errors: [{ message: error.message }] });
		}
	});

	router.post('/', async (request, response, next) => {
		try {
			const {
				collection,
				fields,
				rows,
				filter: sharedFilter = {},
				ttlMs,
			} = request.body;

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
						ttlMs,
					};
				});
			}));

			const fills = fillsByRow.flat();

			const redisKeys = await Promise.all(fills.map((fill) => {
				return fillEntry(request, fill);
			}));

			if (ttlMs === undefined) {
				response.json({ filled: fills.length });

				return;
			}

			response.json({
				filled: fills.length,
				expiringKeys: rawEntryKeys(redisKeys[0]),
			});
		}
		catch (error) {
			next(error);
		}
	});
}
