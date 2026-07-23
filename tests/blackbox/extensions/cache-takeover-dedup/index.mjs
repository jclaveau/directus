// DECLARED take-over for the #292 narrow path (cache-takeover-scope.test.ts). On a
// create of the enrollment collection it looks the row up by its (student, course)
// pair; if the enrollment exists it returns its PK (a take-over). This dedup is
// READ-ONLY — it never moves the row — so it also declares the slice it depends on,
// opting the take-over out of the coarse fallback and into a precise, scoped purge.
//
// It reuses the lookup's OWN scoped tags (`result.getMeta().scopedCacheTags`) rather
// than hand-building one: the read already pinned the exact slice it depends on, so
// the declaration can't drift from it and covers relational/multi-field scope too.
//
// The lookup runs on `context.database` (the mutation trx) so a row created earlier
// in the same request is visible.

const ENROLLMENT = 'test_items_enrollment';
const PAIR = ['student', 'course'];

export default function registerHooks({ filter }, { services }) {
	filter(`${ENROLLMENT}.items.create`, async (payload, _meta, context) => {
		const itemsService = new services.ItemsService(ENROLLMENT, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const filterByPair = Object.fromEntries(
			PAIR.map((field) => [field, { _eq: payload[field] }]),
		);

		const result = await itemsService.readByQuery(
			{ filter: filterByPair, fields: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		const [existing] = result;

		if (!existing) {
			return payload;
		}

		// Purge by the read's pinned slice(s) — a create is a mutation, so this is the
		// purge side. For a (student: ada, course: algebra) lookup the scope field
		// `student` pins one tag, which is exactly what to invalidate:
		//   [{
		//     collection: 'test_items_enrollment',
		//     field: 'student', value: 'ada', type: 'string',
		//   }]
		context.scopedCache?.purgeBy(result.getMeta?.()?.scopedCacheTags ?? []);

		return existing.id;
	});
}
