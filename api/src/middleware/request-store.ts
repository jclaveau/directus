import type { RequestHandler } from 'express';
import { emptyRequestState, requestStore } from '../utils/request-store.js';

/**
 * Opens the request's store: the services its nested writes and hooks build
 * name their scoped-cache purges in it beside its own service's (read by the
 * CACHE_PURGED_TAGS_HEADER and an extension's `scopedCache.readRequestPurges`),
 * and the query audit records its SQL there.
 *
 * Emptied once the response finished: a socket the request opened (a new pool
 * connection, a keep-alive agent) keeps the store alive as long as it stays
 * open, and nothing reads the list or the audit after the response. A client
 * hanging up closes the response while the request still runs, so its store
 * is kept for the rest of the request.
 */
const openRequestStore: RequestHandler = (_req, res, next) => {
	const requestState = emptyRequestState();

	res.once('close', () => {
		if (!res.writableFinished) {
			return;
		}

		delete requestState.scopedCachePurged;
		delete requestState.queryAudit;
	});

	requestStore.run(requestState, next);
};

export default openRequestStore;
