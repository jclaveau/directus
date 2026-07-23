// UNDECLARED take-over that MOVES a row between slices — the poison case the coarse
// fallback exists for (cache-takeover-scope.test.ts). On a create of the transfer
// collection it finds the existing enrollment for that course and re-assigns it to
// the new student (an UPDATE, in the mutation transaction), then returns its PK — a
// take-over that is really an upsert-move.
//
// It declares NOTHING. Its old slice (the previous student) is unrecoverable from
// the post-commit re-read, so the framework MUST purge coarse; a narrow guess would
// leave the old student's cached read stale. This proves that coarse fallback holds.

const TRANSFER = 'test_items_enrollment_transfer';

export default function registerHooks({ filter }, { services }) {
	filter(`${TRANSFER}.items.create`, async (payload, _meta, context) => {
		const itemsService = new services.ItemsService(TRANSFER, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const [existing] = await itemsService.readByQuery(
			{ filter: { course: { _eq: payload.course } }, fields: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		if (!existing) {
			return payload;
		}

		// Re-assign the existing enrollment to the new student — the row moves slices. A
		// raw update on the trx knex, so it doesn't recurse through the service purge.
		await context
			.database(TRANSFER)
			.where({ id: existing.id })
			.update({ student: payload.student });

		return existing.id;
	});
}
