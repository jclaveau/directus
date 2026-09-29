// A collection-wide purge on demand (cache-collection-index-keys.test.ts,
// cache-index-reap.test.ts, cache-index-marker.test.ts). A row handed over
// without its primary key leaves its own key slice unresolvable, so the host
// purges every read of the
// collection — the one purge that finds the collection's sets through its
// index-key set alone.
//   POST /:collection — purge every cached read of that collection.

export default function registerEndpoint(router, { scopedCache }) {
	router.post('/:collection', async (req, res) => {
		await scopedCache.purgeForMutatedRows(req.params.collection, [{}]);

		res.json({ purged: req.params.collection });
	});
}
