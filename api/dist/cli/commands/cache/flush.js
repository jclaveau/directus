import { useLogger } from "../../../logger/index.js";
import { redisConfigAvailable } from "../../../redis/utils/redis-config-available.js";
import "../../../redis/index.js";
import { flushCaches } from "../../../cache.js";
import { drainStdout } from "../../utils/drain-stdout.js";

//#region src/cli/commands/cache/flush.ts
/**
* The boot-path flush (`flushCachesIfBuildChanged`) is keyed to the build
* identity, so it fires once, before this process serves anything. A deploy step
* that changes DATA the cache is derived from — a schema import, a permission
* sync — runs after that and has no way to say so, leaving every node answering
* from the pre-change read. This is that way: the same flush, invoked when the
* change lands rather than when the container starts.
*
* How long it may take before the deploy step gives up on it is CACHE_FLUSH_TIMEOUT,
* armed by the CLI entrypoint — see `armDeadline`.
*/
async function cacheFlush() {
	const logger = useLogger();
	if (!redisConfigAvailable()) logger.warn("[cache] no REDIS is configured, so this reaches no other node");
	let report;
	try {
		report = await flushCaches(true);
	} catch (error) {
		logger.error(error);
	}
	if (report === void 0) await exitWhenLogged(1);
	else if (report.failures.length > 0) {
		logger.error(`[cache] flush incomplete: ${report.failures.join(", ")}`);
		await exitWhenLogged(1);
	} else await exitWhenLogged(0);
}
async function exitWhenLogged(code) {
	await drainStdout();
	process.exit(code);
}

//#endregion
export { cacheFlush as default };