// READ-side scope declaration (cache-read-scope.test.ts). A read of `report` depends
// on `metric` rows it summarises, but the two are separate collections — a metric
// write would not invalidate a cached report on its own. This hook runs a custom
// readByQuery over the metric slice the report depends on and passes THAT read's own
// returned `scopedCacheTags` to `context.scopedCache.scopeTo`, folding the
// metric[owner] slice into the report read's cache tags. Now a create in that metric
// slice invalidates the cached report too.
//
// It reuses the lookup's returned tags rather than build one, so the declared
// dependency can't drift from the slice the lookup actually pinned.

const REPORT = 'test_items_report';
const METRIC = 'test_items_metric';
const OWNER = 'acme';

export default function registerHooks({ filter }, { services }) {
	filter(`${REPORT}.items.read`, async (records, _meta, context) => {
		const metricService = new services.ItemsService(METRIC, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const result = await metricService.readByQuery(
			{ filter: { owner: { _eq: OWNER } }, fields: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		// The metric read's own purge counters ride along with its tags: the host
		// captured `report`'s before its query and cannot have captured `metric`'s,
		// so without this the report response is left uncached (`unguarded_scope`).
		context.scopedCache?.scopeTo(result.getMeta?.()?.scopedCacheTags ?? [], {
			epochs: result.getMeta?.()?.scopedCacheEpochs,
		});

		return records;
	});
}
