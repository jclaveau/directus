// A collection-wide purge on demand (cache-collection-index-keys.test.ts,
// cache-index-reap.test.ts, cache-index-marker.test.ts). A row handed over
// without its primary key leaves its own key slice unresolvable, so the host
// purges every read of the
// collection — the one purge that finds the collection's sets through its
// index-key set alone.
//   POST /:collection — purge every cached read of that collection.

export default function registerEndpoint(router, { scopedCache }) {
	router.post('/:collection', async (req, res) => {
		if (!req.accountability?.admin) {
			return res.status(403).json({ errors: [{ message: 'admin only' }] });
		}

		try {
			await scopedCache.purgeForMutatedRows(req.params.collection, [{}]);

			return res.json({ purged: req.params.collection });
		}
		catch (error) {
			// A bare extension route has no async-error wrapper: a throw here would
			// hang the request rather than answer it.
			return res.status(500).json({ errors: [{ message: error.message }] });
		}
	});
}
