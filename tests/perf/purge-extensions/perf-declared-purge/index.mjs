// Creating a `perf_declared_signal` row declares through `scopedCache.purgeBy`
// the fingerprints its `declared` field carries, so the purge-scaling bench can
// time a declared purge with no rows of the purged collection written.

export default function registerHooks({ filter }) {
	filter('perf_declared_signal.items.create.one', (payload, _meta, context) => {
		context.scopedCache?.purgeBy(payload.declared);

		return payload;
	});
}
