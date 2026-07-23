// Minimal take-over hook for the #293 scoped-purge witness
// (cache-takeover-scope.test.ts). On a create of the enrollment collection it looks
// the row up by its (student, course) pair; if that enrollment exists it returns
// its PK, which Directus reads as a take-over, skipping the insert. No
// `scopedCache.addTag` here — #293 proves the framework narrows a take-over to the
// taken-over row's own slice unaided; the cross-collection addTag layer is #292.
//
// The lookup runs on `context.database` (the mutation transaction) so an earlier row
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
			{ filter: filterByPair, fields: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		return existing
			? existing.id
			: payload;
	});
}
