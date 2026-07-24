// Create-filter CANCELLATION (returning null) against the scoped cache
// (cache-takeover-scope.test.ts). A create hook can veto a row by returning null,
// which Directus cancels under `allowFilterCancel` (the REST create path). A pure
// veto changed nothing, so the framework must NOT purge — the vetoed row's slice
// stays warm. A veto that DID touch state out of band can still scope an explicit
// purge via `scopedCache.purgeBy`, the same escape hatch a take-over uses.
//
//   - body 'spam'    → veto, declare nothing → no purge (slice stays warm).
//   - body 'flagged' → veto, but declare the channel slice → precise purge.
//
// The 'flagged' branch reuses a lookup's own `scopedCacheTags` (like the dedup hook)
// rather than build a tag, so the declaration can't drift from the cached slice.

const MODERATED = 'test_items_moderated';

export default function registerHooks({ filter }, { services }) {
	filter(`${MODERATED}.items.create`, async (payload, _meta, context) => {
		if (payload.body !== 'spam' && payload.body !== 'flagged') {
			return payload;
		}

		if (payload.body === 'flagged') {
			const itemsService = new services.ItemsService(MODERATED, {
				schema: context.schema,
				accountability: context.accountability,
				knex: context.database,
			});

			const result = await itemsService.readByQuery(
				{ filter: { channel: { _eq: payload.channel } }, fields: ['id'], limit: 1 },
				{ emitEvents: false },
			);

			context.scopedCache?.purgeBy(result.getMeta?.()?.scopedCacheTags ?? []);
		}

		// Veto the row: Directus cancels it. 'spam' declared nothing; 'flagged' declared
		// its channel slice above.
		return null;
	});
}
