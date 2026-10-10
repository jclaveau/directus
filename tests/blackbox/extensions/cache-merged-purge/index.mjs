// Creating a `merged_purge_signal` row updates the `merged_purge_row` rows it
// names one by one, through an ItemsService on the signal's own transaction: the
// shape of a hook writing per row, each write queueing its purge until COMMIT
// (#593). The purges a transaction queues for one collection run as one (#594).
//
// A filter (not action) hook, so the writes stay in the awaited critical path and
// on the signal's transaction.

const ROW = 'merged_purge_row';
const SIGNAL = 'merged_purge_signal';

export default function registerHooks({ filter }, { services }) {
	filter(`${SIGNAL}.items.create.one`, async (payload, _meta, context) => {
		const rowService = new services.ItemsService(ROW, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		for (const updatedId of payload.updated_ids ?? []) {
			await rowService.updateOne(updatedId, payload.updated_values);
		}

		return payload;
	});
}
