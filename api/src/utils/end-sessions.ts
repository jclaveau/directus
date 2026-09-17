import { Action } from '@directus/constants';
import type { PrimaryKey } from '@directus/types';
import type { Knex } from 'knex';
import { createHash } from 'node:crypto';
import { useBus } from '../bus/index.js';

export type SessionSelector =
	| { tokens: string[] }
	| { users: PrimaryKey[]; exceptToken?: string | undefined };

export type EndedSession = {
	token: string;
	user: string | null;
	impersonator: string | null;
	ip: string | null;
	user_agent: string | null;
	origin: string | null;
};

/**
 * What the sockets are told. Tokens travel hashed: the bus is Redis pub/sub,
 * and a session socket's accountability holds the raw one.
 */
export type SessionEndedEvent = {
	tokens: string[];
	/** Every socket of these users, and every socket impersonating as them. */
	users: PrimaryKey[];
	exceptTokens: string[];
};

export const SESSION_ENDED_CHANNEL = 'session.ended';

export function hashSessionToken(token: string): string {
	return createHash('sha256')
		.update(token)
		.digest('hex');
}

/**
 * The one place a session ends outside its own expiry: logout, Stop, a kick
 * on the user's status or credentials, a refresh on a user no longer active.
 * Ends the impersonations the user was running too, writes the trail for
 * every impersonated row, and tells the sockets. Returns the rows it ended.
 */
export async function endSessions(
	knex: Knex,
	selector: SessionSelector,
): Promise<EndedSession[]> {
	const query = knex
		.select('token', 'user', 'impersonator', 'ip', 'user_agent', 'origin')
		.from('directus_sessions');

	if ('tokens' in selector) {
		query.whereIn('token', selector.tokens);
	}
	else {
		query.where((rows) => {
			rows.whereIn('user', selector.users).orWhereIn('impersonator', selector.users);
		});

		if (selector.exceptToken) {
			query.andWhereNot('token', '=', selector.exceptToken);
		}
	}

	const ended: EndedSession[] = await query;

	if (ended.length > 0) {
		await knex('directus_sessions')
			.whereIn('token', ended.map((row) => row.token))
			.delete();

		const impersonations = ended.filter((row) => row.impersonator !== null);

		if (impersonations.length > 0) {
			await knex('directus_activity').insert(
				impersonations.map((row) => {
					return {
						action: Action.IMPERSONATE_END,
						user: row.impersonator,
						impersonator: null,
						ip: row.ip,
						user_agent: row.user_agent,
						origin: row.origin,
						collection: 'directus_users',
						item: row.user,
						timestamp: new Date(),
					};
				}),
			);
		}
	}

	const event: SessionEndedEvent = {
		tokens: ended.map((row) => hashSessionToken(row.token)),
		users: [],
		exceptTokens: [],
	};

	if ('users' in selector) {
		event.users = selector.users;

		if (selector.exceptToken) {
			event.exceptTokens = [hashSessionToken(selector.exceptToken)];
		}
	}

	if (event.tokens.length > 0 || event.users.length > 0) {
		await useBus().publish(SESSION_ENDED_CHANNEL, event);
	}

	return ended;
}
