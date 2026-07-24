// A READ-side scoped-cache POISONING limit (#292). A read hook that enriches its
// response from another collection makes a cache dependency the framework can't see.
// With NO `scopeTo` at all, the framework has no signal the dependency exists, so a
// write to it leaves the enriched read a STALE HIT. An author-contract limit, NOT a
// framework bug (the paired correct behavior is in cache-read-scope.test.ts).
//
// (The sibling "declared but unautopurgeable scopeTo" case is handled — not a leak —
// so it lives in cache-unautopurgeable-scope.test.ts, not here.)

const P1_ARTICLE = 'p_read_article';
const P1_AUTHOR = 'p_read_author';

export default function registerHooks({ filter }, { services }) {
	// P1 — enrich from P1_AUTHOR with NO scopeTo. The article read now depends on the
	// author row, but nothing tags it, so an author write can't purge it.
	filter(`${P1_ARTICLE}.items.read`, async (records, _meta, context) => {
		const authorService = new services.ItemsService(P1_AUTHOR, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const authors = await authorService.readByQuery(
			{ filter: { space: { _eq: 'a' } }, fields: ['name'], limit: 1 },
			{ emitEvents: false },
		);

		const name = authors[0]?.name ?? null;

		for (const record of records) {
			record.author_name = name;
		}

		return records;
	});
}
