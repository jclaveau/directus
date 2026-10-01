// Out-of-band counterpart to cache-poisoning-write (#304). Raw-writes related
// collections via knex (bypassing ItemsService, so no auto purge), then calls
// context.scopedCache.purgeForMutatedRows on each. The mutated owner's slices
// refresh with no whole-cache flush; another owner's slices survive.
//   POST /           — two flat owner-scoped collections (surgical per-owner purge).
//   POST /relational — a collection scoped through an M2O; the host reads the rows
//     back by key to resolve the terminal, so only the written owner's slices go.
//   POST /relational-delete — raw-deletes an owner's entries: the read back finds
//     none of them, so it degrades to a collection-wide purge.
//   POST /relational-unreadable — hands over a key no row can match, and on
//     postgres one the read back throws on: both degrade to a collection-wide purge.

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
			.select('id', 'owner');

		await database(LINE)
			.where({ owner })
			.increment('revision', 1);

		const lineRows = await database(LINE)
			.where({ owner })
			.select('id', 'owner');

		// Hand each collection the rows it wrote; the host derives the touched owner
		// slice from scoped_cache_fields and purges only that (+ the bare tag). The
		// primary key travels too: every collection pins that slice, so a row without
		// it leaves its own key unresolvable and the host degrades to collection-wide.
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
			.select('id', 'account');

		// ENTRY is scoped through account.owner: the raw row carries only the account
		// fk, so the host joins the owner in by the rows' keys.
		await scopedCache.purgeForMutatedRows(ENTRY, entryRows);

		res.json({ entries: entryRows.length });
	});

	router.post('/relational-delete', async (req, res) => {
		const { owner } = req.body;

		const accountIds = (
			await database(ACCOUNT)
				.where({ owner })
				.select('id')
		).map((row) => row.id);

		const entryRows = await database(ENTRY)
			.whereIn('account', accountIds)
			.select('id', 'account');

		await database(ENTRY)
			.whereIn('account', accountIds)
			.delete();

		await scopedCache.purgeForMutatedRows(ENTRY, entryRows);

		res.json({ entries: entryRows.length });
	});

	router.post('/relational-unreadable', async (req, res) => {
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
			.select('id', 'account');

		// Not an integer: postgres refuses it in the read back's `whereIn`.
		await scopedCache.purgeForMutatedRows(ENTRY, [
			...entryRows,
			{ id: 'not-a-key', account: null },
		]);

		res.json({ entries: entryRows.length });
	});
}
