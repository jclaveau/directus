import Redis from 'ioredis';
import { sleep } from './sleep';

/**
 * Run a flush, and wait for the reap it requests to finish its pass. Until
 * then the pass may unname the members a scenario reads back, and move the
 * purge counter a fill in flight checks, which evicts that fill's entry.
 *
 * A flush keeps the completeness marker, and the pass writes back the value it
 * holds, so the marker is set to a value no generation holds before the flush:
 * reading the generation again in it is what says the pass ended.
 */
export async function awaitRequestedReap(
	redisPort: number,
	namespace: string,
	flush: () => Promise<unknown>,
	timeoutMs = 15_000,
): Promise<void> {
	const redisClient = new Redis({ host: 'localhost', port: redisPort });
	const markerKey = `${namespace}:scoped-cache-collection-index-keys-complete`;
	const generationKey = `${namespace}:scoped-cache-index-generation`;

	try {
		await redisClient.set(markerKey, 'awaiting-the-flush-reap');
		await flush();

		const deadline = Date.now() + timeoutMs;

		while (Date.now() < deadline) {
			const [marker, generation] = await redisClient.mget(
				markerKey,
				generationKey,
			);

			if (marker === generation) {
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
