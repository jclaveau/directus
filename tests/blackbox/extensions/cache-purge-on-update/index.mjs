// UPDATE-side purge declaration (cache-update-scope.test.ts). Updating an `order`
// should invalidate the owner's cached `summary` — another collection that
// aggregates orders. The framework purges the order's own slice, but nothing reaches
// the summary. This update hook resolves the owner of the order(s) being updated
// (from meta.keys, read before the update commits), looks up that owner's summary
// slice, and passes the lookup's returned scopedCacheTags to `scopedCache.purgeBy`.
//
// Resolving the owner from the updated keys keeps the purge precise. Reuses the
// lookup's tags rather than build one, so the declared purge can't drift.

const ORDER = 'test_items_order';
const SUMMARY = 'test_items_summary';

export default function registerHooks({ filter }, { services }) {
	filter(`${ORDER}.items.update`, async (payload, meta, context) => {
		const orderService = new services.ItemsService(ORDER, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const [updated] = await orderService.readMany(
			meta.keys,
			{ fields: ['owner'], limit: 1 },
			{ emitEvents: false },
		);

		if (!updated) {
			return payload;
		}

		const summaryService = new services.ItemsService(SUMMARY, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const affected = await summaryService.readByQuery(
			{ filter: { owner: { _eq: updated.owner } }, fields: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		context.scopedCache?.purgeBy(affected.getMeta?.()?.scopedCacheTags ?? []);

		return payload;
	});
}
