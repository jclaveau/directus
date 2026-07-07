// Probes DB connection routing. `/route` reports which connection a set of grants
// resolves to (reads the knex's target db, no query). `/exhaust` saturates a
// one-connection pool so the real pool-exhaustion error surfaces (→ 429).
export default (router, { services, getSchema }) => {
	const { ItemsService } = services;

	async function routedKnex(grants) {
		const dbConnections = Array.isArray(grants)
			? grants
			: [];

		const accountability = {
			role: null,
			roles: [],
			user: null,
			admin: false,
			app: false,
			ip: null,
			dbConnections,
		};

		const schema = await getSchema();
		const service = new ItemsService('directus_users', { schema, accountability });

		return service.knex;
	}

	router.post('/route', async (req, res) => {
		if (!req.accountability?.admin) {
			return res.status(403).json({ errors: [{ message: 'admin only' }] });
		}

		const knex = await routedKnex(req.body?.dbConnections);
		const connection = knex.client?.config?.connection;

		let database = connection;

		if (connection && typeof connection === 'object') {
			database = connection.database;
		}

		return res.json({ data: { database } });
	});

	router.post('/exhaust', async (req, res, next) => {
		if (!req.accountability?.admin) {
			return res.status(403).json({ errors: [{ message: 'admin only' }] });
		}

		const concurrency = Number(req.body?.concurrency) || 3;
		const sleepSeconds = Number(req.body?.sleep) || 0.5;

		const knex = await routedKnex(req.body?.dbConnections);

		try {
			const queries = Array.from({ length: concurrency }, () => {
				return knex.raw('SELECT pg_sleep(?)', [sleepSeconds]);
			});

			await Promise.all(queries);

			return res.json({ data: { exhausted: false } });
		}
		catch (error) {
			// Let the global error handler translate the pool error → 429 DATABASE_POOL_EXHAUSTED
			return next(error);
		}
	});
};
