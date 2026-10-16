// Drives ItemsService writes no REST route makes the way these tests need them,
// for write-cache-hook-failures.test.ts and write-cache-out-of-range-key.test.ts.
// Each takes `collection` and runs without accountability.
//
//   POST /create-many                 — createMany over `payloads`.
//   POST /update-many                 — updateMany of `keys` with `data`.
//   POST /delete-many                 — deleteMany of `keys`, a cancel refused.
//   POST /upsert-many                 — upsertMany over `payloads`.
//   POST /upsert-many-shared          — the same on a transaction of this
//     extension's, committed whether the upsert failed or not.
//
// Routes here have no asyncHandler around them, so an escaping rejection would
// exit the process: every one answers with a status instead of throwing.

export default function registerEndpoint(
	router,
	{ services, getSchema, database },
) {
	const answerWith = (handleRequest) => {
		return async (req, res) => {
			try {
				const schema = await getSchema();
				const writtenKeys = await handleRequest(req.body, schema);

				res.json({ keys: writtenKeys });
			}
			catch (error) {
				res
					.status(error?.status ?? 500)
					.json({ message: error?.message ?? null });
			}
		};
	};

	router.post('/create-many', answerWith(({ collection, payloads }, schema) => {
		return new services.ItemsService(collection, { schema })
			.createMany(payloads);
	}));

	router.post('/update-many', answerWith(({ collection, keys, data }, schema) => {
		return new services.ItemsService(collection, { schema })
			.updateMany(keys, data);
	}));

	router.post('/delete-many', answerWith(({ collection, keys }, schema) => {
		return new services.ItemsService(collection, { schema })
			.deleteMany(keys);
	}));

	router.post('/upsert-many', answerWith(({ collection, payloads }, schema) => {
		return new services.ItemsService(collection, { schema })
			.upsertMany(payloads);
	}));

	router.post(
		'/upsert-many-shared',
		answerWith(async ({ collection, payloads }, schema) => {
			let upsertFailure = null;

			const upsertedKeys = await database.transaction((trx) => {
				return new services.ItemsService(collection, { schema, knex: trx })
					.upsertMany(payloads)
					.catch((error) => {
						upsertFailure = error;

						return null;
					});
			});

			if (upsertFailure !== null) {
				throw upsertFailure;
			}

			return upsertedKeys;
		}),
	);
}
