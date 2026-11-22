import type { Accountability } from '@directus/types';
import { DEFAULT_AUTH_PROVIDER } from '../constants.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { createDefaultAccountability } from '../permissions/utils/create-default-accountability.js';
import { AuthenticationService } from '../services/index.js';
import { getAccountabilityForToken } from '../utils/get-accountability-for-token.js';
import { getSchema } from '../utils/get-schema.js';
import { isEqual, pick } from '../utils/lodash-es-used.js';
import { WebSocketError } from './errors.js';
import { customAccountabilities } from './memberships-changed.js';
import type { BasicAuthMessage, WebSocketResponse } from './messages.js';
import type { AuthenticationState } from './types.js';
import { getExpiresAtForToken } from './utils/get-expires-at-for-token.js';

export async function authenticateConnection(
	message: BasicAuthMessage & Record<string, any>,
	accountabilityOverrides?: Partial<Accountability>,
): Promise<AuthenticationState> {
	let access_token: string | undefined, refresh_token: string | undefined;

	try {
		if ('email' in message && 'password' in message) {
			const authenticationService = new AuthenticationService({ schema: await getSchema() });
			const { accessToken, refreshToken } = await authenticationService.login(DEFAULT_AUTH_PROVIDER, message);
			access_token = accessToken;
			refresh_token = refreshToken;
		}

		if ('refresh_token' in message) {
			const authenticationService = new AuthenticationService({ schema: await getSchema() });
			const { accessToken, refreshToken } = await authenticationService.refresh(message.refresh_token);
			access_token = accessToken;
			refresh_token = refreshToken;
		}

		if ('access_token' in message) {
			access_token = message.access_token;
		}

		if (!access_token) throw new Error();

		const defaultAccountability = createDefaultAccountability(accountabilityOverrides);

		const authenticationState = {
			accountability: defaultAccountability,
			expires_at: getExpiresAtForToken(access_token),
			refresh_token,
		} as AuthenticationState;

		const customAccountability = await emitter.emitFilter(
			'websocket.authenticate',
			defaultAccountability,
			{
				message,
			},
			{
				database: getDatabase(),
				schema: null,
				accountability: null,
			},
		);

		if (customAccountability && isEqual(customAccountability, defaultAccountability) === false) {
			const rolesChanged = await filterChangedRoles(
				customAccountability,
				access_token,
				accountabilityOverrides,
			);

			if (rolesChanged) {
				customAccountabilities.add(customAccountability);
			}

			authenticationState.accountability = customAccountability;
		} else {
			authenticationState.accountability = await getAccountabilityForToken(access_token, defaultAccountability);
		}

		return authenticationState;
	} catch {
		throw new WebSocketError('auth', 'AUTH_FAILED', 'Authentication failed.', message['uid']);
	}
}

// What a refresh recomputes: the roles of the user, and what they grant. A
// filter rarely sets the connections: none reads as the token's empty list,
// as the connection pools read it.
function roleStateOf(accountability: Accountability) {
	return {
		...pick(accountability, ['user', 'memberRoles', 'roles', 'admin', 'app']),
		grantedDbConnections: accountability.grantedDbConnections ?? [],
	};
}

/**
 * Whether the `websocket.authenticate` filter handed the socket other roles
 * than its token gives: a membership change recomputes the token's, so only a
 * socket whose filter left them may be refreshed in place. A token only the
 * filter knows has no roles to compare with, the filter's are all it has.
 */
async function filterChangedRoles(
	customAccountability: Accountability,
	accessToken: string,
	accountabilityOverrides: Partial<Accountability> | undefined,
): Promise<boolean> {
	let tokenAccountability: Accountability;

	try {
		// A fresh default: it fills the accountability it is handed.
		tokenAccountability = await getAccountabilityForToken(
			accessToken,
			createDefaultAccountability(accountabilityOverrides),
		);
	}
	catch {
		return true;
	}

	return !isEqual(
		roleStateOf(customAccountability),
		roleStateOf(tokenAccountability),
	);
}

export function authenticationSuccess(uid?: string | number, refresh_token?: string): string {
	const message: WebSocketResponse = {
		type: 'auth',
		status: 'ok',
	};

	if (uid !== undefined) {
		message.uid = uid;
	}

	if (refresh_token !== undefined) {
		message['refresh_token'] = refresh_token;
	}

	return JSON.stringify(message);
}
