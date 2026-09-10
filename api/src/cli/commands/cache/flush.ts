import { flushCaches } from '../../../cache.js';
import { useLogger } from '../../../logger/index.js';

/**
 * The boot-path flush (`flushCachesIfBuildChanged`) is keyed to the build identity, so it
 * fires once, before this process serves anything. A deploy step that changes DATA the
 * cache is derived from — a schema import, a permission sync — runs after that and has no
 * way to say so, leaving every node answering from the pre-change read. This is that way:
 * the same flush, invoked when the change lands rather than when the container starts.
 */
export default async function cacheFlush(): Promise<void> {
	const logger = useLogger();

	try {
		await flushCaches(true);
	}
	catch (error: any) {
		logger.error(error);
		process.exit(1);
	}

	// Outside the catch: `process.exit` throws under test, and inside it that throw
	// would be swallowed and reported as the flush having failed.
	process.exit(0);
}
