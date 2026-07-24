// A mutation hook whose SIDE EFFECT is a programmatic write to ANOTHER collection,
// via ItemsService — NOT a `scopedCache.purgeBy` declaration. Updating a `source`
// row runs a bookkeeping write on a `target` slice. Because that nested write is a
// real ItemsService mutation, it runs `target`'s own purge pipeline and self-
// invalidates `target`'s cached slice — no cache wiring in the hook. This is the
// framework floor: a nested mutation invalidates its own collection on its own, so
// `purgeBy` is only ever needed for writes that BYPASS ItemsService (raw knex) or
// suppress its purge (`autoPurgeCache: false`).
//
// A filter (not action) hook so the nested write stays in the awaited critical
// path — an action hook is fire-and-forget and would race the test's read.

const SOURCE = 'test_nested_source';
const TARGET = 'test_nested_target';
const TARGET_SPACE = 'x';

export default function registerHooks({ filter }, { services }) {
	filter(`${SOURCE}.items.update`, async (payload, _meta, context) => {
		const targetService = new services.ItemsService(TARGET, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const rows = await targetService.readByQuery(
			{ filter: { space: { _eq: TARGET_SPACE } }, fields: ['id'], limit: -1 },
			{ emitEvents: false },
		);

		const keys = rows.map((row) => row.id);

		if (keys.length > 0) {
			// Plain ItemsService write, no scopedCache call — its own purge invalidates
			// TARGET[space=x] precisely, leaving the sibling slice warm.
			await targetService.updateMany(keys, { tally: 1 });
		}

		return payload;
	});
}
