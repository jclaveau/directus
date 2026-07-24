// DECLARED take-over for the #292 narrow path (cache-takeover-scope.test.ts). A real
// M2M write: the parent update nests `authors.create`, and Directus turns each link
// into a create on the junction. This hook dedups the junction by its (article,
// author) FK pair — if the pair already links it returns the existing junction PK (a
// take-over) rather than insert a duplicate that would hit UNIQUE(article, author).
//
// The dedup is READ-ONLY — it never moves a row — so it also declares the slice it
// depends on (the lookup's own `scopedCacheTags`), opting the take-over out of the
// coarse fallback and into a precise, scoped purge.
//
// The lookup runs on `context.database` (the mutation trx) so a junction row created
// earlier in the same request is visible.

const JUNCTION = 'test_items_article_author';
const PAIR = ['test_items_article_id', 'test_items_author_id'];

export default function registerHooks({ filter }, { services }) {
	filter(`${JUNCTION}.items.create`, async (payload, _meta, context) => {
		const itemsService = new services.ItemsService(JUNCTION, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const filterByPair = Object.fromEntries(
			PAIR.map((field) => [field, { _eq: payload[field] }]),
		);

		const result = await itemsService.readByQuery(
			{ filter: filterByPair, fields: ['id'], limit: 1 },
			{ emitEvents: false },
		);

		const [existing] = result;

		if (!existing) {
			return payload;
		}

		// Purge by the read's pinned slice — the junction is scoped by its article FK,
		// so an (article: 1, author: 1) lookup pins one tag, exactly what to drop:
		//   [{
		//     collection: 'test_items_article_author',
		//     field: 'test_items_article_id', value: 1, type: 'integer',
		//   }]
		context.scopedCache?.purgeBy(result.getMeta?.()?.scopedCacheTags ?? []);

		return existing.id;
	});
}
