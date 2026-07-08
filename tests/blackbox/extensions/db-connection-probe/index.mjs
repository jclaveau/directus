// Probes DB connection granting/pooling. `/granted` reports which connection a
// set of grants resolves to (no query). `/pools-under-load` saturates pools,
// then probes pools: `onProbeError: 'report'` records per-pool ok/fail
// (isolation), `'propagate'` rethrows so a saturated pool surfaces as 429
// DATABASE_POOL_EXHAUSTED.
export default (router, { services, getSchema }) => {
	const { ItemsService } = services;

	async function grantedKnex(grants, share) {
		const accountability = {
			role: null,
			roles: [],
			user: null,
			admin: false,
			app: false,
			ip: null,
			grantedDbConnections: Array.isArray(grants)
				? grants
				: [],
			share: share || null,
		};

		const schema = await getSchema();

		return new ItemsService('directus_users', { schema, accountability }).knex;
	}

	router.post('/granted', async (req, res) => {
		if (!req.accountability?.admin) {
			return res.status(403).json({ errors: [{ message: 'admin only' }] });
		}

		const { grantedDbConnections, share } = req.body ?? {};

		try {
			const knex = await grantedKnex(grantedDbConnections, share);
			const connection = knex.client?.config?.connection;

			let database = connection;

			if (connection && typeof connection === 'object') {
				database = connection.database;
			}

			return res.json({ data: { database } });
		}
		catch (error) {
			// Resolving a misconfigured named connection throws; surface it as a 500
			// so the shared test server survives — a bare extension route has no
			// async-error wrapper, unlike a real Directus controller.
			return res.status(500).json({ errors: [{ message: error.message }] });
		}
	});

	// Saturate the given pools (fire sleeping queries, don't await — hold them),
	// then probe the given pools with a quick query. `onProbeError` decides what a
	// failing probe does: `report` records ok/error per pool (200) — the saturated
	// pool's own failure is the non-vacuity control; `propagate` rethrows it so the
	// global error handler translates the pool error → 429 DATABASE_POOL_EXHAUSTED.
	router.post('/pools-under-load', async (req, res, next) => {
		if (!req.accountability?.admin) {
			return res.status(403).json({ errors: [{ message: 'admin only' }] });
		}

		const saturate = Array.isArray(req.body?.saturate)
			? req.body.saturate
			: [];

		const probes = Array.isArray(req.body?.probe)
			? req.body.probe
			: [];

		const sleepSeconds = Number(req.body?.sleep) || 3;

		const onProbeError = req.body?.onProbeError === 'propagate'
			? 'propagate'
			: 'report';

		for (const { connection, concurrency } of saturate) {
			const knex = await grantedKnex([connection]);

			for (let i = 0; i < (Number(concurrency) || 1); i++) {
				knex.raw('SELECT pg_sleep(?)', [sleepSeconds]).catch(() => {});
			}
		}

		// Give the sleeping queries a moment to occupy every server connection.
		await new Promise((resolve) => setTimeout(resolve, 400));

		const results = {};

		for (const name of probes) {
			const knex = await grantedKnex([name]);
			const startedAt = Date.now();

			try {
				await knex.raw('SELECT 1');
				results[name] = { ok: true, ms: Date.now() - startedAt };
			}
			catch (error) {
				if (onProbeError === 'propagate') {
					return next(error);
				}

				results[name] = { ok: false, error: error.message };
			}
		}

		return res.json({ data: { results } });
	});
};
