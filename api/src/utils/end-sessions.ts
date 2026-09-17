import type { PrimaryKey } from '@directus/types';
import type { Knex } from 'knex';

export type SessionSelector =
	| { tokens: string[] }
	| { users: PrimaryKey[]; exceptToken?: string | undefined };

export type EndedSession = {
	token: string;
	user: string | null;
};

/**
 * The one place a session ends outside its own expiry: logout, a kick on the
 * user's status or credentials, a refresh on a user no longer active. Returns
 * the rows it ended so the caller can tell the sockets and the trail.
 */
export async function endSessions(
	knex: Knex,
	selector: SessionSelector,
): Promise<EndedSession[]> {
	const query = knex.select('token', 'user').from('directus_sessions');

	if ('tokens' in selector) {
		query.whereIn('token', selector.tokens);
	}
	else {
		query.whereIn('user', selector.users);

		if (selector.exceptToken) {
			query.andWhereNot('token', '=', selector.exceptToken);
		}
	}

	const ended = await query;

	if (ended.length > 0) {
		await knex('directus_sessions')
			.whereIn('token', ended.map((row) => row.token))
			.delete();
	}

	return ended;
}
