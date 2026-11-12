import { AsyncLocalStorage } from 'node:async_hooks';
import type { QueryAudit } from '../database/query-audit.js';
import type { ScopedCachePurgedRecord } from '../scoped-cache/purged-record.js';

/**
 * What one HTTP request or websocket message holds while it runs: the SQL audit
 * QUERY_AUDIT_HEADER asked for, and the list of the scoped-cache purges it
 * reached. Opened once per HTTP request by `openRequestStore`, per websocket
 * message, per GraphQL websocket operation, per schedule tick, and per flow run
 * with none open; let go with the last async work it started, and an HTTP
 * request's emptied once its response closed.
 */
export type RequestState = {
	queryAudit?: QueryAudit;
	scopedCachePurged?: ScopedCachePurgedRecord;
};

export const requestStore = new AsyncLocalStorage<RequestState>();

export function emptyRequestState(): RequestState {
	return { scopedCachePurged: { purged: [], queuedPurges: [] } };
}

/**
 * Runs work in the store already open, or in a new one when none is: a flow
 * a request fires names its purges in that request's list, one a schedule or a
 * CLI write fires gets a list of its own.
 */
export function joinRequestStore<T>(work: () => T): T {
	if (requestStore.getStore()) {
		return work();
	}

	return requestStore.run(emptyRequestState(), work);
}
