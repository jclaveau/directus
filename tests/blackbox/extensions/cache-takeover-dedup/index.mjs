// Minimal take-over hook for the #293 scoped-purge witness
// (cache-takeover-scope.test.ts). On a create of the scoped test collection it looks
// the row up by `dedup_key`; if one exists it returns that PK, which Directus reads
// as a take-over, skipping the insert.
//
// No `scopedCache.addTag` here — #293 proves the framework narrows a take-over to
// the taken-over row's own slice unaided; the cross-collection addTag layer is #292.
//
// The lookup runs on `context.database` (the mutation transaction) so an earlier row
// in the same request is visible.

const DEDUP_COLLECTION = 'test_items_takeover_scoped';
const DEDUP_KEY = 'dedup_key';

export default function registerHooks({ filter }, { services }) {
	filter(`${DEDUP_COLLECTION}.items.create`, async (payload, _meta, context) => {
		const itemsService = new services.ItemsService(DEDUP_COLLECTION, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const [existing] = await itemsService.readByQuery(
			{
				filter: { [DEDUP_KEY]: { _eq: payload[DEDUP_KEY] } },
				fields: ['id'],
				limit: 1,
			},
			{ emitEvents: false },
		);

		return existing
			? existing.id
			: payload;
	});
}
