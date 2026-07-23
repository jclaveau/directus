// DECLARED take-over for the #292 narrow path (cache-takeover-scope.test.ts). On a
// create of the enrollment collection it looks the row up by its (student, course)
// pair; if the enrollment exists it returns its PK (a take-over). This dedup is
// READ-ONLY — it never moves the row — so it also declares the one slice it depends
// on via `context.scopedCache.addTag`, opting the take-over out of the coarse
// fallback and into a precise, scoped purge.
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

		const [existing] = await itemsService.readByQuery(
			{ filter: filterByPair, fields: ['id', 'student'], limit: 1 },
			{ emitEvents: false },
		);

		if (!existing) {
			return payload;
		}

		// Read-only dedup: the row isn't moved, so its slice is the only dependency.
		// Declaring it narrows the take-over purge to this student instead of coarse.
		context.scopedCache?.addTag({
			collection: ENROLLMENT,
			field: 'student',
			value: existing.student,
		});

		return existing.id;
	});
}
