import type { RequestHandler } from 'express';
import { emptyRequestState, requestStore } from '../utils/request-store.js';

/**
 * Opens the request's store: the services its nested writes and hooks build
 * name their scoped-cache purges in it beside its own service's (read by the
 * CACHE_PURGED_TAGS_HEADER and an extension's `scopedCache.readRequestPurges`),
 * and the query audit records its SQL there.
 */
const openRequestStore: RequestHandler = (_req, _res, next) => {
	requestStore.run(emptyRequestState(), next);
};

export default openRequestStore;
