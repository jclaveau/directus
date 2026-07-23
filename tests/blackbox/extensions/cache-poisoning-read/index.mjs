// Two READ-side scoped-cache POISONING limits (#292). A read hook that enriches its
// response from another collection makes a cache dependency the framework can't see.
// If the author does not declare it via `scopeTo` — or declares a tag the purge side
// can't reproduce — a write to that collection leaves the enriched read a STALE HIT.
// These are author-contract limits, NOT framework bugs; the paired correct behavior
// (declaring a reproducible tag) lives in cache-read-scope.test.ts.

const P1_ARTICLE = 'p_read_article';
const P1_AUTHOR = 'p_read_author';
const P4_READ = 'p_read_badread';
const P4_DEP = 'p_read_baddep';

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

	// P4 — enrich from P4_DEP and DECLARE scopeTo, but on a field P4_DEP is not scoped
	// on (`ghost`). The purge side emits P4_DEP's real slices + bare tag, never
	// `ghost=g`, so the tag is orphaned and a dep write still can't purge this read.
	filter(`${P4_READ}.items.read`, async (records, _meta, context) => {
		const depService = new services.ItemsService(P4_DEP, {
			schema: context.schema,
			accountability: context.accountability,
			knex: context.database,
		});

		const deps = await depService.readByQuery(
			{ filter: { space: { _eq: 'd' } }, fields: ['val'], limit: 1 },
			{ emitEvents: false },
		);

		context.scopedCache?.scopeTo({
			collection: P4_DEP,
			field: 'ghost',
			value: 'g',
		});

		const val = deps[0]?.val ?? null;

		for (const record of records) {
			record.dep_val = val;
		}

		return records;
	});
}
