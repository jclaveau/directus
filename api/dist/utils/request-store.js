import { AsyncLocalStorage } from "node:async_hooks";

//#region src/utils/request-store.ts
const requestStore = new AsyncLocalStorage();
function emptyRequestState() {
	return { scopedCachePurged: {
		purged: [],
		queuedPurges: []
	} };
}
/**
* Runs work in the store already open, or in a new one when none is: a flow
* a request fires names its purges in that request's list, one a schedule or a
* CLI write fires gets a list of its own.
*/
function joinRequestStore(work) {
	if (requestStore.getStore()) return work();
	return requestStore.run(emptyRequestState(), work);
}

//#endregion
export { emptyRequestState, joinRequestStore, requestStore };