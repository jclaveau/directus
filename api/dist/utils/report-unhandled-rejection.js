import { useLogger } from "../logger/index.js";
import { useMetrics } from "../metrics/lib/use-metrics.js";
import "../metrics/index.js";

//#region src/utils/report-unhandled-rejection.ts
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
* killing the foreground, not to stop hearing about it.
*/
function reportUnhandledRejection(reason) {
	const reported = reason instanceof Error ? reason : { reason };
	useLogger().error(reported, `Unhandled promise rejection: ${reason}`);
	useMetrics()?.getUnhandledRejectionMetric().inc();
}

//#endregion
export { reportUnhandledRejection };