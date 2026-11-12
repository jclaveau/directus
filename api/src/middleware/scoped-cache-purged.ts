import type { RequestHandler } from 'express';
import { scopedCachePurgedStore } from '../scoped-cache/purged-record.js';

/**
 * Opens the request's purged list, so the purges of the services its nested
 * writes and hooks build are named beside its own service's: in the
 * CACHE_PURGED_TAGS_HEADER, and to an extension's
 * `scopedCache.readRequestPurges`.
 */
const recordRequestScopedCachePurges: RequestHandler = (_req, _res, next) => {
	scopedCachePurgedStore.run({ purged: [], queuedPurges: [] }, next);
};

export default recordRequestScopedCachePurges;
