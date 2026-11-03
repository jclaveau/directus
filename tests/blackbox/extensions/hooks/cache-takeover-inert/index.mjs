// INERT take-over for cache-takeover-scope.test.ts. Same shape as the declared dedup
// beside it — a create resolves to a row that already exists, so the hook returns
// that PK instead of inserting — except this one writes NOTHING at all: the stored
// row already holds every value the payload carries.
//
// A take-over is scoped COARSE by default because it can be an update in disguise
// that MOVED the row between slices, which the create path cannot recover. Writing
// nothing rules that out, so the hook says so with `skipPurgeFor` and the service
// purges nothing — neither the fallback nor a slice.
//
// The lookup runs on `context.transaction` (the mutation trx) so a row created
// earlier in the same request is visible.

import { mapCreateRows } from '@directus/utils';

const COLLECTION = 'test_items_inert_dedup';

export default function registerHooks({ filter }, { services }) {
	filter(`${COLLECTION}.items.create`, (entries, _meta, context) => {
		return mapCreateRows(entries, async (payload) => {
			const itemsService = new services.ItemsService(COLLECTION, {
				schema: context.schema,
				accountability: context.accountability,
				knex: context.transaction,
			});

			const [existing] = await itemsService.readByQuery(
				{
					filter: {
						channel: { _eq: payload.channel },
						body: { _eq: payload.body },
					},
					fields: ['id'],
					limit: 1,
				},
				{ emitEvents: false },
			);

			if (!existing) {
				return payload;
			}

			// Nothing to write and nothing to drop: the row already holds this payload.
			context.scopedCache?.skipPurgeFor(existing.id);

			return existing.id;
		});
	});
}
