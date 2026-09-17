// A conditionally-pinning read hook: the cache audit's `tag_drift` witness. The
// read of DRIFT is scoped to whichever `owner` slice of DRIFT_DEP the dependency
// row holds at read time. Move that row outside the API (raw SQL, no purge) and
// the entry's body still matches the database, but a replay pins another slice
// than the entry was filled under — one write to the new slice from stale.

const DRIFT = 'test_cache_audit_drift';
const DRIFT_DEP = 'test_cache_audit_drift_dep';

export default function registerHooks({ filter }) {
	filter(`${DRIFT}.items.read`, async (records, _meta, context) => {
		const dependency = await context.database(DRIFT_DEP).first('owner');

		// Seeded after DRIFT: the create's own read-back finds no row to pin on.
		if (dependency === undefined) {
			return records;
		}

		context.scopedCache?.scopeTo({
			collection: DRIFT_DEP,
			field: 'owner',
			value: dependency.owner,
		});

		return records;
	});
}
