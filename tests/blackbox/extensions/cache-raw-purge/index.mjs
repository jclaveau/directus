// Out-of-band counterpart to cache-poisoning-write (#304). Raw-writes two related
// collections for ONE owner via knex (bypassing ItemsService, so no auto purge),
// then calls context.scopedCache.purgeForMutatedRows on each. The mutated owner's
// slices refresh with no whole-cache flush; another owner's slices survive.

const DOCUMENT = 'rawpurge_document';
const LINE = 'rawpurge_document_line';

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
		// slice from scoped_cache_fields and purges only that (+ the bare tag).
		await scopedCache.purgeForMutatedRows(DOCUMENT, documentRows);
		await scopedCache.purgeForMutatedRows(LINE, lineRows);

		res.json({ documents: documentRows.length, lines: lineRows.length });
	});
}
