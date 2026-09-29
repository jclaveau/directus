// Holds the first fill of index_reap_window between its index and its value
// (cache-index-reap.test.ts), until a reap has taken the entry's members out: the
// SET has not run, so the reap finds them naming nothing. Unguarded, the fill then
// writes an entry no index set names, which no purge reaches for its whole TTL.

import Redis from 'ioredis';

const INDEX_REAP_WINDOW = 'index_reap_window';
const reapWaitMs = 10_000;

let alreadyHeld = false;

export default function registerHooks({ action }) {
	action('cache.indexed', async ({ redisKey, fingerprints }) => {
		const windowRead = fingerprints
			.find((fingerprint) => fingerprint.collection === INDEX_REAP_WINDOW);

		if (alreadyHeld || !windowRead) {
			return;
		}

		alreadyHeld = true;

		const redisClient = new Redis({
			host: process.env['REDIS_HOST'],
			port: Number(process.env['REDIS_PORT']),
		});

		const bareIndexKey = `${process.env['CACHE_NAMESPACE']}:scoped-cache-index:`
			+ `fingerprint:${INDEX_REAP_WINDOW}:`;

		// A read pinning a name is filed under that name's home pin set.
		const pinnedNames = windowRead.pinnedScope?.name ?? [];

		const indexKeys = [
			bareIndexKey,
			...pinnedNames.map((name) => `${bareIndexKey}pin:name=${name}`),
		];

		const deadline = Date.now() + reapWaitMs;

		try {
			while (Date.now() < deadline) {
				const indexMembers = await redisClient.sunion(...indexKeys);

				if (!indexMembers.some((member) => member.includes(`|${redisKey}`))) {
					return;
				}

				await new Promise((resolve) => setTimeout(resolve, 100));
			}
		}
		finally {
			await redisClient.quit();
		}
	});
}
