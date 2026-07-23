// Deduplicating M2M pivot rows from a create *filter* hook — the canonical use case
// for `context.scopedCache.addTag`. On every create of the pivot collection the hook
// looks the pair up by its two foreign keys; if a row exists it returns that row's
// PK, which Directus treats as a "take over" and skips the insert. Otherwise it
// returns the payload unchanged and the row is created normally.
//
// Notes that matter for correctness:
//   - The lookup MUST run on `context.database` (the mutation's transaction) so a
//     row created earlier in the same request is visible; a fresh connection misses.
//   - Best-effort optimizer, not a lock: two concurrent requests can both miss and
//     both insert. A real deployment pairs it with a UNIQUE(left,right) index.
//   - `context.scopedCache.addTag` lets the hook name the exact slice it touched so
//     the purge stays scoped, not the coarse whole-collection purge a take-over
//     forces (see the cache-handling note in the accompanying test).

const DEDUP_COLLECTION = 'test_items_pivot_dedup';
const PIVOT_KEYS = ['left_id', 'right_id'];

export default function registerHooks({ filter }, { services }) {
	filter(`${DEDUP_COLLECTION}.items.create`, async (payload, _meta, context) => {
		const itemsService = new services.ItemsService(DEDUP_COLLECTION, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database, // the mutation transaction — see note above
		});

		const filterByKeys = Object.fromEntries(
			PIVOT_KEYS.map((key) => [key, { _eq: payload[key] }]),
		);

		const [existing] = await itemsService.readByQuery(
			{ filter: filterByKeys, fields: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		if (!existing) {
			return payload;
		}

		// Declare the slice this create depends on so a scoped purge stays precise.
		context.scopedCache?.addTag({
			collection: DEDUP_COLLECTION,
			field: 'id',
			value: existing.id,
		});

		// Returning a PK makes Directus skip the insert and reuse the existing row.
		return existing.id;
	});
}
