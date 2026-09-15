// The same in-flight window as `cache-read-inflight-purge`, opened by a whole-cache
// FLUSH instead of a write. `dropScopedCacheTagIndex` bumps the wholesale counter
// before it scans, precisely so a read whose tags are not filed yet declines to
// store itself — a flush finding no tag set at all still has to invalidate the reads
// crossing it, and there is no tag set to drop for a read that has not reached
// `respond`.
//
// Over HTTP because the flush lives in the API's own cache module, which an
// extension has no handle on; the endpoint is the surface it is reached by anyway.

const COLLECTION = 'read_inflight_flush';

// The blackbox admin fixture (`USER.ADMIN.TOKEN`), which an extension cannot import.
const ADMIN_TOKEN = 'AdminToken';

let alreadyFired = false;

export default function registerHooks({ filter }) {
	filter(`${COLLECTION}.items.read`, async (payload) => {
		// Set before the await so the flush's own reads cannot re-enter, and so the
		// test's second read runs against an untouched hook.
		if (alreadyFired) {
			return payload;
		}

		alreadyFired = true;

		await fetch(`http://127.0.0.1:${process.env['PORT']}/utils/cache/clear`, {
			method: 'POST',
			headers: { Authorization: `Bearer ${ADMIN_TOKEN}` },
		});

		return payload;
	});
}
