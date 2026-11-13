// Creating a `perf_declared_signal` row declares through `scopedCache.purgeBy`
// the fingerprints its `declared` field carries, so the purge-scaling bench can
// time a declared purge with no rows of the purged collection written.

export default function registerHooks({ filter }) {
	filter('perf_declared_signal.items.create', (entries, _meta, context) => {
		for (const entry of entries) {
			if (entry?.data) {
				context.scopedCache?.purgeBy(entry.data.declared);
			}
		}

		return entries;
	});
}
