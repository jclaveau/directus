import Redis from 'ioredis';
import { sleep } from './sleep';

/**
 * Wait for the reap a flush or a boot requests to mark the namespace's
 * index-key sets complete, which it does as its pass ends. Until then the pass
 * may unname the members a scenario reads back, and move the purge counter a
 * fill in flight checks, which evicts that fill's entry.
 */
export async function awaitRequestedReap(
	redisPort: number,
	namespace: string,
	timeoutMs = 15_000,
): Promise<void> {
	const redisClient = new Redis({ host: 'localhost', port: redisPort });
	const markerKey = `${namespace}:scoped-cache-index:collection-index-keys-complete`;
	const generationKey = `${namespace}:scoped-cache-index-generation`;
	const deadline = Date.now() + timeoutMs;

	try {
		while (Date.now() < deadline) {
			const [marker, generation] = await redisClient.mget(
				markerKey,
				generationKey,
			);

			if (marker !== null && marker === generation) {
				return;
			}

			await sleep(100);
		}

		throw new Error(
			`no reap marked the ${namespace} index complete in ${timeoutMs} ms`,
		);
	}
	finally {
		await redisClient.quit();
	}
}
