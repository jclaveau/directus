// Undeclared take-over that MOVES the seeded child between scope slices, reached via
// the O2M array form (routes to upsertMany) — the missing guard B#3 predicts.

import { mapCreateRows } from '@directus/utils';

const CHILD = 'test_b3_child';

export default function registerHooks({ filter }, { services }) {
	filter(`${CHILD}.items.create`, (entries, _meta, context) => {
		return mapCreateRows(entries, async (payload) => {
			const childService = new services.ItemsService(CHILD, {
				schema: context.schema,
				accountability: context.accountability,
				knex: context.transaction,
			});

			const [movable] = await childService.readByQuery(
				{ filter: { marker: { _eq: 'movable' } }, fields: ['id'], limit: 1 },
				{ emitEvents: false },
			);

			if (!movable) {
				return payload;
			}

			// Raw trx update, no service purge recursion; only the PK is surfaced.
			await context
				.transaction(CHILD)
				.where({ id: movable.id })
				.update({ slot: payload.slot });

			return movable.id;
		});
	});
}
