// Declares a purge for slot=a, then empties the update payload (returns {}). B#4:
// updateMany's changedFields===0 early return then drops the declared purge.

const COLLECTION = 'test_b4_scoped';

export default function registerHooks({ filter }, { services }) {
	filter(`${COLLECTION}.items.update`, async (payload, _meta, context) => {
		if (payload.slot !== '__drop__') {
			return payload;
		}

		const service = new services.ItemsService(COLLECTION, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const result = await service.readByQuery(
			{ filter: { slot: { _eq: 'a' } }, fields: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		context.scopedCache?.purgeBy(result.getMeta?.()?.scopedCacheTags ?? []);

		// Empty payload — not null — so it is a no-op update, not a filter cancel.
		return {};
	});
}
