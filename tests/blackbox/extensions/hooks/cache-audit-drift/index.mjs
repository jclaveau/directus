// A conditionally-pinning read hook: the cache audit's `pin_drift` witness. The
// read of DRIFT is scoped to whichever `owner` slice of DRIFT_DEP the dependency
// row holds at read time. Move that row outside the API (raw SQL, no purge) and
// the entry's body still matches the database, but a replay pins another slice
// than the entry was filled under — one write to the new slice from stale.

const DRIFT = 'test_cache_audit_drift';
const DRIFT_DEP = 'test_cache_audit_drift_dep';

export default function registerHooks({ filter }, { services }) {
	filter(`${DRIFT}.items.read`, async (records, _meta, context) => {
		// Through the service, not raw knex: the pin below names a collection the
		// host snapshotted no purge counter for, and only a read's own snapshot, handed
		// over with the pin, keeps the response cacheable (`unguarded_scope`).
		const dependencies = await new services.ItemsService(DRIFT_DEP, {
			schema: context.schema,
			knex: context.database,
		}).readByQuery({ fields: ['owner'], limit: 1 }, { emitEvents: false });

		const [dependency] = dependencies;

		// Seeded after DRIFT: the create's own read-back finds no row to pin on.
		if (dependency === undefined) {
			return records;
		}

		context.scopedCache?.scopeTo(
			{ collection: DRIFT_DEP, pinnedScope: { owner: [dependency.owner] } },
			{ epochs: dependencies.getMeta?.()?.scopedCacheEpochs },
		);

		return records;
	});
}
