import type { RequestHandler } from 'express';
import { scopedCachePurgedStore } from '../scoped-cache/purged-record.js';

/**
 * Dev-only, under CACHE_PURGED_TAGS_HEADER: opens the request's purged list, so
 * the purges of the services its nested writes and hooks build land in the header
 * beside its own service's.
 */
const recordRequestScopedCachePurges: RequestHandler = (_req, _res, next) => {
	scopedCachePurgedStore.run({ purged: [] }, next);
};

export default recordRequestScopedCachePurges;
