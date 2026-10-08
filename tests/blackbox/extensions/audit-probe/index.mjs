// Two reads inside one open transaction: `/pool-read` sends the
// second through the pool, which hands it another connection while the
// transaction pins the first; `/transaction-read` sends both through the
// transaction. A bare extension route has no async-error wrapper, so a failed
// read answers 500 rather than exit the shared test server.
export default (router, { database }) => {
	function adminOnly(runReads) {
		return async (req, res) => {
			if (!req.accountability?.admin) {
				return res.status(403).json({ errors: [{ message: 'admin only' }] });
			}

			try {
				await runReads();

				return res.json({ data: null });
			}
			catch (error) {
				return res.status(500).json({ errors: [{ message: error.message }] });
			}
		};
	}

	function readSettings(reader) {
		return reader('directus_settings')
			.select('id')
			.where('id', 1);
	}

	function readTwiceInTransaction(secondReader) {
		return adminOnly(() => {
			return database.transaction(async (trx) => {
				await readSettings(trx);
				await readSettings(secondReader(trx));
			});
		});
	}

	// A read, a savepoint rolled back over a read, a read past it, then the
	// whole transaction rolled back.
	async function rollBackPastSavepoint() {
		const transactionUndone = new Error('undo the transaction');

		try {
			await database.transaction(async (trx) => {
				await readSettings(trx);

				await trx.transaction(async (savepoint) => {
					await readSettings(savepoint);

					throw new Error('undo the savepoint');
				}).catch(() => {});

				await readSettings(trx);

				throw transactionUndone;
			});
		}
		catch (error) {
			if (error !== transactionUndone) {
				throw error;
			}
		}
	}

	router.get('/pool-read', readTwiceInTransaction(() => database));
	router.get('/transaction-read', readTwiceInTransaction((trx) => trx));
	router.get('/savepoint-rollback', adminOnly(rollBackPastSavepoint));

	router.get('/accented-sql', adminOnly(() => {
		return database.raw('select \'café\' as accented_value\nfrom directus_settings');
	}));

	// Each read outside a transaction is an entry of its own: 400 of them
	// outgrow 8kb even as their kind and table alone.
	router.get('/many-pool-reads', adminOnly(async () => {
		for (let readNumber = 0; readNumber < 400; readNumber++) {
			await readSettings(database);
		}
	}));

	// Past Number.MAX_SAFE_INTEGER, `search` binds a number as a BigInt.
	router.get('/bigint-binding', adminOnly(() => {
		return database.raw('select ?::bigint as big_value', [9007199254740993n]);
	}));
};
