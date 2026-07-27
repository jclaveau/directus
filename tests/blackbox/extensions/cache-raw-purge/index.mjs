// Out-of-band counterpart to cache-poisoning-write (#304). Raw-writes related
// collections via knex (bypassing ItemsService, so no auto purge), then calls
// context.scopedCache.purgeForMutatedRows on each. The mutated owner's slices
// refresh with no whole-cache flush; another owner's slices survive.
//   POST /           — two flat owner-scoped collections (surgical per-owner purge).
//   POST /relational — a collection scoped through an M2O; the raw row can't resolve
//     the terminal, so it degrades to a collection-wide purge (never stale, spares
//     other collections).

const DOCUMENT = 'rawpurge_document';
const LINE = 'rawpurge_document_line';
const ACCOUNT = 'rawpurge_account';
const ENTRY = 'rawpurge_entry';

export default function registerEndpoint(router, { database, scopedCache }) {
	router.post('/', async (req, res) => {
		const { owner } = req.body;

		// Two related collections mutated sequentially by raw SQL — no ItemsService,
		// so nothing self-purges.
		await database(DOCUMENT)
			.where({ owner })
			.increment('revision', 1);

		const documentRows = await database(DOCUMENT)
			.where({ owner })
			.select('owner');

		await database(LINE)
			.where({ owner })
			.increment('revision', 1);

		const lineRows = await database(LINE)
			.where({ owner })
			.select('owner');

		// Hand each collection the rows it wrote; the host derives the touched owner
		// slice from scoped_cache_fields and purges only that (+ the bare tag).
		await scopedCache.purgeForMutatedRows(DOCUMENT, documentRows);
		await scopedCache.purgeForMutatedRows(LINE, lineRows);

		res.json({ documents: documentRows.length, lines: lineRows.length });
	});

	router.post('/relational', async (req, res) => {
		const { owner } = req.body;

		const accountIds = (
			await database(ACCOUNT)
				.where({ owner })
				.select('id')
		).map((row) => row.id);

		await database(ENTRY)
			.whereIn('account', accountIds)
			.increment('revision', 1);

		const entryRows = await database(ENTRY)
			.whereIn('account', accountIds)
			.select('account');

		// ENTRY is scoped through account.owner — the raw row carries only the account
		// fk, not the terminal owner, so the host falls back to a collection-wide purge.
		await scopedCache.purgeForMutatedRows(ENTRY, entryRows);

		res.json({ entries: entryRows.length });
	});
}
