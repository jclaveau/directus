// Forces the collection-wide branch of a scoped purge, which no HTTP write reaches:
// a write through ItemsService always resolves its own slice, so the fallback that
// drops every slice a collection owns is only taken by a caller handing over rows it
// cannot resolve.
//
// `purgeForMutatedRows` documents that shape — a row missing a scope field yields
// null tags, and `purgeScopedCache` then purges the collection rather than risk a
// silently stale slice. Passing a row with nothing on it is the shortest way there.
//
// The route answers with a status rather than throwing: there is no asyncHandler
// around an extension endpoint, and an escaping rejection exits the process.

export default function registerEndpoint(router, { scopedCache }) {
	router.post('/coarse-purge', async (req, res) => {
		try {
			const { collection } = req.body ?? {};

			if (typeof collection !== 'string' || collection.length === 0) {
				res.status(400).json({ message: 'missing string "collection"' });
				return;
			}

			await scopedCache.purgeForMutatedRows(collection, [{}]);

			res.json({ purged: collection });
		}
		catch (error) {
			res.status(500).json({ message: error?.message ?? null });
		}
	});
}
