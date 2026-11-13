// Answers what `context.scopedCache.readRequestPurges` reads after a write
// (cache-request-purges.test.ts). Every route sets `revision` to 1 on the
// reqpurge_lesson rows of the keys it is sent, then answers
// `{ purged: <the request's purged list> }`.
//   POST /update — one items-service update per key, one after another.
//   POST /update-in-transaction — the same, inside a transaction opened raw
//     through `database.transaction()`.
//   POST /raw-update — a knex update, its rows handed to `purgeForMutatedRows`.
//   POST /read-only — writes nothing.

const LESSON = 'reqpurge_lesson';

export default function registerEndpoint(
	router,
	{ services, database, getSchema, scopedCache },
) {
	const { ItemsService } = services;

	// A bare extension route has no async-error wrapper: a throw would hang the
	// request rather than answer it.
	function answerPurges(writeRows) {
		return async (req, res) => {
			try {
				await writeRows(req);

				return res.json({ purged: await scopedCache.readRequestPurges() });
			}
			catch (error) {
				return res.status(500).json({ errors: [{ message: error.message }] });
			}
		};
	}

	router.post('/update', answerPurges(async (req) => {
		const lessonService = new ItemsService(LESSON, {
			schema: await getSchema(),
		});

		for (const lessonKey of req.body.keys) {
			await lessonService.updateOne(lessonKey, { revision: 1 });
		}
	}));

	router.post('/update-in-transaction', answerPurges(async (req) => {
		const schema = await getSchema();

		await database.transaction(async (trx) => {
			const lessonService = new ItemsService(LESSON, { schema, knex: trx });

			for (const lessonKey of req.body.keys) {
				await lessonService.updateOne(lessonKey, { revision: 1 });
			}
		});
	}));

	router.post('/raw-update', answerPurges(async (req) => {
		await database(LESSON)
			.whereIn('id', req.body.keys)
			.update({ revision: 1 });

		const lessonRows = await database(LESSON)
			.whereIn('id', req.body.keys)
			.select('id', 'owner');

		await scopedCache.purgeForMutatedRows(LESSON, lessonRows);
	}));

	router.post('/read-only', answerPurges(async () => {}));
}
