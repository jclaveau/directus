import { InvalidPayloadError, InvalidQueryError, UnsupportedMediaTypeError } from '@directus/errors';
import argon2 from 'argon2';
import Busboy from 'busboy';
import { Router } from 'express';
import Joi from 'joi';
import type { CacheFlushTarget } from '../cache.js';
import collectionExists from '../middleware/collection-exists.js';
import { respond } from '../middleware/respond.js';
import { ExportService, ImportService } from '../services/import-export.js';
import { RevisionsService } from '../services/revisions.js';
import { UtilsService } from '../services/utils.js';
import asyncHandler from '../utils/async-handler.js';
import { generateHash } from '../utils/generate-hash.js';
import { getMilliseconds } from '../utils/get-milliseconds.js';
import { sanitizeQuery } from '../utils/sanitize-query.js';

const router = Router();

const randomStringSchema = Joi.object<{ length: number }>({
	length: Joi.number().integer().min(1).max(500).default(32),
});

// The cache-listing ?window= range (a duration like 48h) → ms; undefined when
// absent so the listing falls back to its default. Clamped downstream.
function requestedWindowMs(raw: unknown): number | undefined {
	return raw === undefined
		? undefined
		: getMilliseconds(String(raw), Number.NaN);
}

router.get(
	'/random/string',
	asyncHandler(async (req, res) => {
		const { nanoid } = await import('nanoid');

		const { error, value } = randomStringSchema.validate(req.query, { allowUnknown: true });

		if (error) throw new InvalidQueryError({ reason: error.message });

		return res.json({ data: nanoid(value.length) });
	}),
);

router.post(
	'/hash/generate',
	asyncHandler(async (req, res) => {
		if (!req.body?.string) {
			throw new InvalidPayloadError({ reason: `"string" is required` });
		}

		const hash = await generateHash(req.body.string);

		return res.json({ data: hash });
	}),
);

router.post(
	'/hash/verify',
	asyncHandler(async (req, res) => {
		if (!req.body?.string) {
			throw new InvalidPayloadError({ reason: `"string" is required` });
		}

		if (!req.body?.hash) {
			throw new InvalidPayloadError({ reason: `"hash" is required` });
		}

		try {
			const result = await argon2.verify(req.body.hash, req.body.string);
			return res.json({ data: result });
		} catch {
			throw new InvalidPayloadError({ reason: `Invalid "hash" or "string"` });
		}
	}),
);

const SortSchema = Joi.object({
	item: Joi.alternatives(Joi.string(), Joi.number()).required(),
	to: Joi.alternatives(Joi.string(), Joi.number()).required(),
});

router.post(
	'/sort/:collection',
	collectionExists,
	asyncHandler(async (req, res) => {
		const { error } = SortSchema.validate(req.body);
		if (error) throw new InvalidPayloadError({ reason: error.message });

		const service = new UtilsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.sort(req.collection, req.body);

		return res.status(200).end();
	}),
);

router.post(
	'/revert/:revision',
	asyncHandler(async (req, _res, next) => {
		const service = new RevisionsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.revert(req.params['revision']!);
		next();
	}),
	respond,
);

router.post(
	'/import/:collection',
	collectionExists,
	asyncHandler(async (req, res, next) => {
		if (req.is('multipart/form-data') === false) {
			throw new UnsupportedMediaTypeError({ mediaType: req.headers['content-type']!, where: 'Content-Type header' });
		}

		const service = new ImportService({
			accountability: req.accountability,
			schema: req.schema,
		});

		let headers;

		if (req.headers['content-type']) {
			headers = req.headers;
		} else {
			headers = {
				...req.headers,
				'content-type': 'application/octet-stream',
			};
		}

		const busboy = Busboy({ headers });

		busboy.on('file', async (_fieldname, fileStream, { mimeType }) => {
			try {
				await service.import(req.params['collection']!, mimeType, fileStream);
			} catch (err: any) {
				return next(err);
			}

			return res.status(200).end();
		});

		busboy.on('error', (err: Error) => next(err));

		req.pipe(busboy);
	}),
);

router.post(
	'/export/:collection',
	collectionExists,
	asyncHandler(async (req, _res, next) => {
		if (!req.body.query) {
			throw new InvalidPayloadError({ reason: `"query" is required` });
		}

		if (!req.body.format) {
			throw new InvalidPayloadError({ reason: `"format" is required` });
		}

		const service = new ExportService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const sanitizedQuery = await sanitizeQuery(req.body.query, req.schema, req.accountability ?? null);

		// We're not awaiting this, as it's supposed to run async in the background
		service.exportToFile(req.params['collection']!, sanitizedQuery, req.body.format, {
			file: req.body.file,
		});

		return next();
	}),
	respond,
);

const CacheClearSchema = Joi.object<{ targets: CacheFlushTarget[] }>({
	targets: Joi.array()
		.items(Joi.string().valid('response', 'system', 'locks'))
		.single()
		.default(['response']),
});

router.post(
	'/cache/clear',
	asyncHandler(async (req, res) => {
		const service = new UtilsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const { error, value } = CacheClearSchema.validate(req.query, {
			allowUnknown: true,
		});

		if (error) {
			throw new InvalidQueryError({ reason: error.message });
		}

		// Retrocompat: the historical `?system` flag cleared the system cache on top of
		// the response cache, so map it onto the targets rather than break old callers.
		const legacySystem = 'system' in req.query
			&& (req.query['system'] === '' || Boolean(req.query['system']));

		const targets = legacySystem && !value.targets.includes('system')
			? [...value.targets, 'system' as const]
			: value.targets;

		await service.clearCache({ targets });

		res.status(200).end();
	}),
);

router.get(
	'/cache',
	asyncHandler(async (req, res, next) => {
		const service = new UtilsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		// Never cache the cache listing itself — it must reflect live state.
		res.locals['cache'] = false;
		const windowMs = requestedWindowMs(req.query['window']);
		res.locals['payload'] = { data: await service.getCacheEntries(windowMs) };

		return next();
	}),
	respond,
);

router.get(
	'/cache/anomalies',
	asyncHandler(async (req, res, next) => {
		const service = new UtilsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		res.locals['cache'] = false;
		const windowMs = requestedWindowMs(req.query['window']);
		res.locals['payload'] = { data: await service.getCacheAnomalies(windowMs) };

		return next();
	}),
	respond,
);

router.get(
	'/cache/entry',
	asyncHandler(async (req, res) => {
		const service = new UtilsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const key = req.query['key'];

		if (typeof key !== 'string') {
			throw new InvalidPayloadError({
				reason: 'A `key` query parameter is required',
			});
		}

		res.json({ data: await service.readCacheEntry(key) });
	}),
);

router.delete(
	'/cache',
	asyncHandler(async (req, res) => {
		const service = new UtilsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const key = req.query['key'];
		const path = req.query['path'];

		if (typeof key === 'string') {
			await service.evictCacheEntry(key);
			res.status(200).json({ data: { evicted: 1 } });
			return;
		}

		if (typeof path === 'string') {
			const evicted = await service.evictCacheEntriesForPath(path);
			res.status(200).json({ data: { evicted } });
			return;
		}

		throw new InvalidPayloadError({
			reason: 'A `key` or `path` query parameter is required to evict cache entries',
		});
	}),
);

router.get(
	'/cache/stats',
	asyncHandler(async (req, res, next) => {
		const service = new UtilsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		res.locals['cache'] = false;
		res.locals['payload'] = { data: await service.getCacheStatsState() };

		return next();
	}),
	respond,
);

router.patch(
	'/cache/stats',
	asyncHandler(async (req, res) => {
		const service = new UtilsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		const enabled = req.body?.enabled;

		if (typeof enabled !== 'boolean') {
			throw new InvalidPayloadError({
				reason: 'An `enabled` boolean is required to toggle cache stats',
			});
		}

		await service.setCacheStatsEnabled(enabled);
		res.status(200).json({ data: { enabled } });
		return;
	}),
);

router.post(
	'/cache/stats/truncate',
	asyncHandler(async (req, res) => {
		const service = new UtilsService({
			accountability: req.accountability,
			schema: req.schema,
		});

		await service.truncateCacheStats();
		res.status(200).json({ data: { truncated: true } });
		return;
	}),
);

export default router;
