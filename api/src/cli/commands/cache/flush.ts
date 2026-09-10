import { flushCaches, type CacheFlushReport } from '../../../cache.js';
import { useLogger } from '../../../logger/index.js';
import { redisConfigAvailable } from '../../../redis/index.js';
import { drainStdout } from '../../utils/drain-stdout.js';

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
export default async function cacheFlush(): Promise<void> {
	const logger = useLogger();

	// This runs in the deploy shell, whose env is not the running service's. With
	// no bus it clears the caches of a process that serves nothing and tells no
	// node, then reports the cluster flushed.
	if (!redisConfigAvailable()) {
		logger.error(
			'[cache] no REDIS is configured, so this would reach no other node',
		);

		await exitWhenLogged(1);
		return;
	}

	let report: CacheFlushReport | undefined;

	try {
		report = await flushCaches(true);
	}
	catch (error: any) {
		logger.error(error);
	}

	// One branch, one exit: `process.exit` does not stop the caller while an `exit`
	// listener runs, and a fallthrough from the failed flush into the report it
	// never returned raises a TypeError out of the handler for exit 1.
	if (report === undefined) {
		await exitWhenLogged(1);
	}
	else if (report.failures.length > 0) {
		// `flushCaches` is best-effort by contract — it warns and carries on rather
		// than throwing — so an exit code read off the absence of an exception would
		// tell a deploy the caches are clear when Redis refused every one of them.
		logger.error(`[cache] flush incomplete: ${report.failures.join(', ')}`);
		await exitWhenLogged(1);
	}
	else {
		await exitWhenLogged(0);
	}
}

// Everything this command reports, it reports by logging it, and the deploy step
// reading that log gets a stdout that is a pipe rather than a TTY — asynchronous,
// and emptied by an exit that does not wait for it.
async function exitWhenLogged(code: number): Promise<void> {
	await drainStdout();
	process.exit(code);
}
