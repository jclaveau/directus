// Probes DB connection routing. `/route` reports which connection a set of grants
// resolves to (reads the knex's target db, no query). `/exhaust` saturates a
// one-connection pool so the real pool-exhaustion error surfaces (→ 429).
export default (router, { services, getSchema }) => {
	const { ItemsService } = services;

	async function routedKnex(grants) {
		const accountability = {
			role: null,
			roles: [],
			user: null,
			admin: false,
			app: false,
			ip: null,
			dbConnections: Array.isArray(grants)
				? grants
				: [],
		};

		const schema = await getSchema();

		return new ItemsService('directus_users', { schema, accountability }).knex;
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
			await Promise.all(
				Array.from({ length: concurrency }, () => {
					return knex.raw('SELECT pg_sleep(?)', [sleepSeconds]);
				}),
			);

			return res.json({ data: { exhausted: false } });
		}
		catch (error) {
			// Let the global error handler translate the pool error → 429
			// DATABASE_POOL_EXHAUSTED
			return next(error);
		}
	});

	// Holds one or more pools saturated (fire sleeping queries, don't await),
	// then probes other pools with a quick query — proving a saturated tier
	// doesn't starve the others. Returns each probe's ok/error so a test can also
	// assert the saturated pool itself failed (the non-vacuity control).
	router.post('/isolation', async (req, res) => {
		if (!req.accountability?.admin) {
			return res.status(403).json({ errors: [{ message: 'admin only' }] });
		}

		const saturate = Array.isArray(req.body?.saturate)
			? req.body.saturate
			: [];

		const probes = Array.isArray(req.body?.probes)
			? req.body.probes
			: [];

		const sleepSeconds = Number(req.body?.sleep) || 3;

		for (const { connection, concurrency } of saturate) {
			const knex = await routedKnex([connection]);

			for (let i = 0; i < (Number(concurrency) || 1); i++) {
				knex.raw('SELECT pg_sleep(?)', [sleepSeconds]).catch(() => {});
			}
		}

		// Give the sleeping queries a moment to occupy every server connection.
		await new Promise((resolve) => setTimeout(resolve, 400));

		const results = {};

		for (const name of probes) {
			const knex = await routedKnex([name]);
			const startedAt = Date.now();

			try {
				await knex.raw('SELECT 1');
				results[name] = { ok: true, ms: Date.now() - startedAt };
			}
			catch (error) {
				results[name] = { ok: false, error: error.message };
			}
		}

		return res.json({ data: { results } });
	});
};
