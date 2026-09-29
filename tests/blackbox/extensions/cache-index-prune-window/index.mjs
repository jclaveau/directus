// Holds the first fill of index_prune_window between its index and its value
// (cache-index-prune.test.ts) for longer than one CACHE_TTL: the value then
// written would outlive the expiry its index members were filed with, and once
// a purge pruned them it would be named by no index set for the rest of its TTL.

const INDEX_PRUNE_WINDOW = 'index_prune_window';

// One CACHE_TTL of the test (8s), and a second more.
const holdMs = 9_000;

let alreadyHeld = false;

export default function registerHooks({ action }) {
	action('cache.indexed', async ({ fingerprints }) => {
		const namesWindow = fingerprints
			.some((fingerprint) => fingerprint.collection === INDEX_PRUNE_WINDOW);

		if (alreadyHeld || !namesWindow) {
			return;
		}

		alreadyHeld = true;

		await new Promise((resolve) => setTimeout(resolve, holdMs));
	});
}
