// DELETE-side purge declaration (cache-delete-scope.test.ts). Deleting a `charge`
// should invalidate the owner's cached `invoice` — another collection that
// aggregates charges. The framework purges the charge's own slice, but nothing
// reaches the invoice. This delete hook resolves the owner of the charge being
// deleted (read before the delete commits), looks up that owner's invoice slice, and
// passes the lookup's returned scopedCacheTags to `context.scopedCache.purgeBy`.
//
// Resolving the owner from the deleted keys (not a hardcoded value) keeps the purge
// precise: deleting one owner's charge leaves another's invoice warm. Reuses the
// lookup's tags rather than build one, so the declared purge can't drift.

const CHARGE = 'test_items_charge';
const INVOICE = 'test_items_invoice';

export default function registerHooks({ filter }, { services }) {
	filter(`${CHARGE}.items.delete`, async (keys, _meta, context) => {
		const chargeService = new services.ItemsService(CHARGE, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const [deleted] = await chargeService.readMany(
			keys,
			{ fields: ['owner'], limit: 1 },
			{ emitEvents: false },
		);

		if (!deleted) {
			return keys;
		}

		const invoiceService = new services.ItemsService(INVOICE, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const affected = await invoiceService.readByQuery(
			{ filter: { owner: { _eq: deleted.owner } }, fields: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		context.scopedCache?.purgeBy(affected.getMeta?.()?.scopedCacheTags ?? []);

		return keys;
	});
}
