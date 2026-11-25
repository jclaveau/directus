// A `websocket.authenticate` filter handing a socket the roles the database
// gives its user plus an ip of its own (#746), for membership-refresh.feature:
// a socket authenticating with a token starting with `ws-auth-tag-` holds every
// role of its user by `sort`, as without the filter, and the ip `203.0.113.7`.
// Every other socket authenticates as usual.

const TOKEN_PREFIX = 'ws-auth-tag-';

export default function registerHooks({ filter }) {
	filter('websocket.authenticate', async (accountability, meta, context) => {
		const { message } = meta;
		const { database } = context;
		const token = message?.access_token;

		if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX)) {
			return accountability;
		}

		const taggedUser = await database
			.select('id')
			.from('directus_users')
			.where({ token })
			.first();

		if (taggedUser === undefined) {
			throw new Error(
				`ws-auth-tag found no user of token ${JSON.stringify(token)}`,
			);
		}

		const memberships = await database
			.select('role')
			.from('directus_role_members')
			.where({ user: taggedUser.id })
			.orderBy('sort');

		const memberRoles = memberships.map(({ role }) => role);

		return {
			...accountability,
			user: taggedUser.id,
			memberRoles,
			roles: memberRoles,
			ip: '203.0.113.7',
		};
	});
}
