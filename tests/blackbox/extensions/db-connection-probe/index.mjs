// Reports which DB connection `getDatabaseForAccountability` routes a given set of policy grants to.
// An ItemsService built with a synthetic accountability runs the real routing; we read the resolved
// knex's target database without issuing a query, so the extra connections can point at fake dbs.
export default (router, { services, getSchema }) => {
	const { ItemsService } = services;

	router.post('/route', async (req, res) => {
		if (!req.accountability?.admin) {
			return res.status(403).json({ errors: [{ message: 'admin only' }] });
		}

		const grants = req.body?.dbConnections;

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

		const connection = service.knex.client?.config?.connection;

		let database = connection;

		if (connection && typeof connection === 'object') {
			database = connection.database;
		}

		return res.json({ data: { database } });
	});
};
