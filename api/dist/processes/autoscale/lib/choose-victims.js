//#region src/processes/autoscale/lib/choose-victims.ts
/**
* Which workers a release should stop, worst candidate first.
*
* pm2 chooses for itself when handed a size: `rmProcs` walks the app's
* processes from the first one, which is the lowest `pm_id` and so the worker
* the pool has had longest. Under keep-alive that is close to the worst
* available choice — node cluster round-robins new connections, so clients stay
* on the workers they already hold sockets to and the oldest worker is the one
* carrying the most live requests. Stopping it drops them.
*
* Ranked on what the worker is doing rather than how long it has been there:
*
* 1. workers that have reported nothing in flight,
* 2. workers that have reported nothing at all,
* 3. workers serving requests, fewest first.
*
* Within a rank the lowest `pm_id` goes first, which is pm2's own order — so a
* pool that reports nothing is released exactly as pm2 would have released it,
* and a signal that stops arriving costs the ranking nothing it had before.
*
* Reporting workers rank ahead of silent ones because silence is not idleness:
* a worker too busy to run its timer, or one on a build that does not report,
* says the same nothing as one with an empty queue.
*/
function chooseVictims(candidates, count) {
	return [...candidates].sort((left, right) => {
		return rank(left) - rank(right) || left.pmId - right.pmId;
	}).slice(0, Math.max(count, 0)).map((worker) => worker.pmId);
}
function rank(worker) {
	if (worker.inFlight === null) return 1;
	return worker.inFlight === 0 ? 0 : 2 + worker.inFlight;
}

//#endregion
export { chooseVictims };