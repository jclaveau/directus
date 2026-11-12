import { AsyncLocalStorage } from 'node:async_hooks';
import type { QueryAudit } from '../database/query-audit.js';
import type { ScopedCachePurgedRecord } from '../scoped-cache/purged-record.js';

/**
 * What one HTTP request or websocket message holds while it runs: the SQL audit
 * QUERY_AUDIT_HEADER asked for, and the list of the scoped-cache purges it
 * reached. Opened once per request by `openRequestStore` and once per websocket
 * message; let go with the last async work it started.
 */
export type RequestState = {
	queryAudit?: QueryAudit;
	scopedCachePurged?: ScopedCachePurgedRecord;
};

export const requestStore = new AsyncLocalStorage<RequestState>();

export function emptyRequestState(): RequestState {
	return { scopedCachePurged: { purged: [], queuedPurges: [] } };
}
