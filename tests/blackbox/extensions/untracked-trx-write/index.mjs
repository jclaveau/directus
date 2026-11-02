// Writes a user's role inside a transaction the extension opens itself with
// `database.transaction()`, then reads as another user before it commits
// (cache-untracked-transaction-flush.feature).
//
//   POST /untracked-trx-write/move-user
//     { user, role, read: { path, query, token } }
//   → { readBeforeCommit: { status, cacheStatus } }
//
// Routes here have no asyncHandler around them, so an escaping rejection would exit
// the process and take the whole shard with it: every one answers with a status
// instead of throwing.

export default function registerEndpoint(
	router,
	{ services, database, getSchema, env },
) {
	router.post('/move-user', async (req, res) => {
		try {
			const { user, role, read } = req.body;
			const schema = await getSchema();

			const readBeforeCommit = await database.transaction(async (trx) => {
				await new services.UsersService({
					knex: trx,
					schema,
					accountability: req.accountability,
				}).updateOne(user, { role });

				const readQuery = new URLSearchParams(read.query);
				const readUrl = `http://127.0.0.1:${env.PORT}${read.path}?${readQuery}`;

				const readResponse = await fetch(readUrl, {
					headers: { Authorization: `Bearer ${read.token}` },
				});

				return {
					status: readResponse.status,
					cacheStatus: readResponse.headers.get(env.CACHE_STATUS_HEADER),
				};
			});

			res.json({ readBeforeCommit });
		}
		catch (error) {
			res.status(500).json({ message: error?.message ?? null });
		}
	});
}
