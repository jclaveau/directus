import { useLogger } from "../logger/index.js";
import { _cache } from "../metrics/lib/instance.js";

//#region src/utils/report-unhandled-rejection.ts
/**
* How long the same failure goes without earning another line.
*
* The volume follows traffic rather than the failure: one rejection per command a
* dead dependency refuses, and ioredis flushes its whole queue at once — seven lines
* a flush from an idle autoscaler, and a process that is serving refuses as many
* commands as it is asked for. A minute is often enough to show an outage is still
* going and rare enough to read.
*/
const REPEAT_AFTER_MS = 6e4;
/**
* How many distinct failures are remembered before the throttle starts over.
*
* A failure carrying an id or a key in its message is a different failure every
* time, and would otherwise grow this map for as long as the process runs.
*/
const DISTINCT_FAILURES_KEPT = 100;
const logged = /* @__PURE__ */ new Map();
/**
* What the process does with a promise rejection nothing awaited.
*
* Node turns one into an uncaught exception, and the API has no shortage of promises
* nothing awaits — a scheduled tick, a fire-and-forget telemetry write, a client
* library settling a command long after its caller gave up. Each is a way for a
* background dependency to exit a process that was serving requests fine: an
* unreachable Redis alone reached it through the shared ioredis client, the bus
* subscriber, the Keyv stores and the scheduler, each fixed at its own site and none
* of which was the last one.
*
* Logged at error, never silently: the point is to keep a background failure from
* killing the foreground, not to stop hearing about it. Throttled to one line per
* distinct failure per minute, because a dependency that is down rejects once per
* command asked of it — the counter is what carries the volume, and the line that
* ends a window says how much it swallowed.
*/
function reportUnhandledRejection(reason) {
	_cache.metrics?.getUnhandledRejectionMetric().inc();
	const failure = reason instanceof Error ? `${reason.name}: ${reason.message}` : String(reason);
	const now = Date.now();
	const seen = logged.get(failure);
	if (seen !== void 0 && now - seen.at < REPEAT_AFTER_MS) {
		seen.suppressed += 1;
		return;
	}
	if (logged.size >= DISTINCT_FAILURES_KEPT) logged.clear();
	const repeats = seen?.suppressed ?? 0;
	logged.set(failure, {
		at: now,
		suppressed: 0
	});
	const reported = reason instanceof Error ? reason : { reason };
	const line = repeats === 0 ? `Unhandled promise rejection: ${reason}` : `Unhandled promise rejection: ${reason} (${repeats} more since the last)`;
	useLogger().error(reported, line);
}
/**
* Take the guard for this process, wherever it entered.
*
* The listener has to be in place before the first promise that can reject
* without an awaiter, and the CLI builds itself — extensions included, bus
* subscription and all — before it reaches the command it was asked for. A
* command taking the guard for itself is a command that has already run the
* riskiest part of its boot without one.
*
* Idempotent so that entry points can each take it without the process
* carrying a listener per import: a rejection answered twice counts twice, and
* the metric is what says how much of an outage this process swallowed.
*/
function guardUnhandledRejections() {
	if (process.listeners("unhandledRejection").includes(reportUnhandledRejection)) return;
	process.on("unhandledRejection", reportUnhandledRejection);
}

//#endregion
export { guardUnhandledRejections, reportUnhandledRejection };