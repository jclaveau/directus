// The caller's identity from the database alone, on the node that opts in.
//
// A node cut from Redis cannot authenticate: its permission lookups are
// cached locally behind a client that raises on an outage, and every peer's
// fill of the same key drops that local copy (#366). The outage case is about
// the audit, so the request reaches it by looking nothing up in a cache.
export default function registerHooks({ filter }, { env, database }) {
	const token = env['CACHE_AUDIT_IDENTITY_TOKEN'];

	if (typeof token !== 'string' || token.length === 0) {
		return;
	}

	filter('authenticate', async (accountability, { req }) => {
		if (req.get('x-cache-audit-identity') !== token) {
			return accountability;
		}

		const user = await database
			.select('id', 'role')
			.from('directus_users')
			.where({ token, status: 'active' })
			.first();

		if (!user) {
			return accountability;
		}

		return {
			...accountability,
			user: user.id,
			role: user.role,
			roles: [user.role],
			admin: true,
			app: true,
		};
	});
}
