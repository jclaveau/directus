// A `websocket.authenticate` filter handing a socket fewer roles than the
// database gives its user (#746), for membership-refresh.feature: a socket
// authenticating with a token starting with `ws-auth-narrow-` holds only the
// first role of its user by `sort`, and is refused when its user holds none.
// Every other socket authenticates as usual.

const TOKEN_PREFIX = 'ws-auth-narrow-';

export default function registerHooks({ filter }) {
	filter('websocket.authenticate', async (accountability, meta, context) => {
		const { message } = meta;
		const { database } = context;
		const token = message?.access_token;

		if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) {
			return accountability;
		}

		const narrowedUser = await database
			.select('id')
			.from('directus_users')
			.where({ token })
			.first();

		if (narrowedUser === undefined) {
			throw new Error(
				`ws-auth-narrow found no user of token ${JSON.stringify(token)}`,
			);
		}

		const firstMembership = await database
			.select('role')
			.from('directus_role_members')
			.where({ user: narrowedUser.id })
			.orderBy('sort')
			.first();

		if (firstMembership === undefined) {
			throw new Error(
				`ws-auth-narrow refuses the user ${JSON.stringify(narrowedUser.id)}:`
					+ ' it holds no role',
			);
		}

		return {
			...accountability,
			user: narrowedUser.id,
			memberRoles: [firstMembership.role],
			roles: [firstMembership.role],
		};
	});
}
