// Two reads inside one open transaction: `/pool-inside-transaction` sends the
// second through the pool, which hands it another connection while the
// transaction pins the first; `/transaction-only` sends both through the
// transaction. A bare extension route has no async-error wrapper, so a failed
// read answers 500 rather than exit the shared test server.
export default (router, { database }) => {
	function readTwiceInTransaction(secondReader) {
		return async (req, res) => {
			if (!req.accountability?.admin) {
				return res.status(403).json({ errors: [{ message: 'admin only' }] });
			}

			try {
				await database.transaction(async (trx) => {
					await trx.raw('SELECT 1');
					await secondReader(trx).raw('SELECT 1');
				});

				return res.json({ data: null });
			}
			catch (error) {
				return res.status(500).json({ errors: [{ message: error.message }] });
			}
		};
	}

	router.get('/pool-inside-transaction', readTwiceInTransaction(() => database));
	router.get('/transaction-only', readTwiceInTransaction((trx) => trx));
};
