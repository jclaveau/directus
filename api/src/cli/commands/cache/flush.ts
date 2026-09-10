import { flushCaches } from '../../../cache.js';
import { useLogger } from '../../../logger/index.js';

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
	let report;

	try {
		report = await flushCaches(true);
	}
	catch (error: any) {
		logger.error(error);
		process.exit(1);
	}

	// Both exits sit outside the catch: `process.exit` throws under test, and inside
	// it that throw would be swallowed and reported as the flush having failed.
	//
	// `flushCaches` is best-effort by contract — it warns and carries on rather than
	// throwing — so an exit code read off the absence of an exception would tell a
	// deploy the caches are clear when Redis refused every one of them.
	if (report.failures.length > 0) {
		logger.error(`[cache] flush incomplete: ${report.failures.join(', ')}`);
		process.exit(1);
	}

	process.exit(0);
}
