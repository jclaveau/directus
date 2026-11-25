// Fails the next read of a user's member roles (#746), the read a socket's
// roles refresh runs once a membership write committed, for
// membership-refresh.feature.
//
//   POST /roles-refresh-failure/arm { user } → { armed }
//
// The read fails once, then the user's reads pass again. Routes here have no
// asyncHandler around them, so an escaping rejection would exit the process:
// the route answers with a status instead of throwing.

const MEMBER_ROLES_SQL = 'select "role" from "directus_role_members"'
	+ ' where "user" = ?';

const armedUsers = new Set();

export default function registerEndpoint(router, { database }) {
	const passQuery = database.client.query;

	database.client.query = function failArmedRead(connection, queryObject) {
		const armedUser = queryObject?.sql?.startsWith(MEMBER_ROLES_SQL)
			? queryObject.bindings?.find((binding) => armedUsers.has(binding))
			: undefined;

		if (armedUser === undefined) {
			return passQuery.call(this, connection, queryObject);
		}

		armedUsers.delete(armedUser);

		return Promise.reject(new Error(
			`roles-refresh-failure failed the member roles read of user`
			+ ` ${JSON.stringify(armedUser)}`,
		));
	};

	router.post('/arm', (req, res) => {
		const armedUser = req.body?.user;

		if (typeof armedUser !== 'string') {
			res.status(400).json({
				message: `"user" must be a string, got ${JSON.stringify(armedUser)}`,
			});

			return;
		}

		armedUsers.add(armedUser);
		res.json({ armed: armedUser });
	});
}
