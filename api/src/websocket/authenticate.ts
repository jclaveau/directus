import type { Accountability } from '@directus/types';
import { DEFAULT_AUTH_PROVIDER } from '../constants.js';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import { createDefaultAccountability } from '../permissions/utils/create-default-accountability.js';
import { AuthenticationService } from '../services/index.js';
import { getAccountabilityForToken } from '../utils/get-accountability-for-token.js';
import { getSchema } from '../utils/get-schema.js';
import { isEqual, omit } from '../utils/lodash-es-used.js';
import { WebSocketError } from './errors.js';
import type { BasicAuthMessage, WebSocketResponse } from './messages.js';
import type { AuthenticationState } from './types.js';
import { getExpiresAtForToken } from './utils/get-expires-at-for-token.js';

/**
 * What a socket the `websocket.authenticate` filter let in authenticated with:
 * a membership change runs the filter again on it. The password and the
 * refresh token were spent at authentication, and are not kept.
 */
type FilterAuthentication = {
	message: Record<string, any>;
	accountabilityOverrides: Partial<Accountability> | undefined;
};

const filterAuthentications = new WeakMap<
	Accountability,
	FilterAuthentication
>();

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

		const customAccountability = await runAuthenticateFilter(
			defaultAccountability,
			message,
		);

		if (customAccountability) {
			filterAuthentications.set(customAccountability, {
				message: omit(message, ['password', 'refresh_token']),
				accountabilityOverrides,
			});

			authenticationState.accountability = customAccountability;
		} else {
			authenticationState.accountability = await getAccountabilityForToken(access_token, defaultAccountability);
		}

		return authenticationState;
	} catch {
		throw new WebSocketError('auth', 'AUTH_FAILED', 'Authentication failed.', message['uid']);
	}
}

/**
 * Runs the `websocket.authenticate` filter again on a socket it let in, with
 * the message and connection the socket authenticated with: its roles are
 * what the filter hands it, not the memberships alone. Null for a socket the
 * filter left as its token made it, or leaves so now. Throws the filter's
 * refusal.
 */
export async function rerunAuthenticateFilter(
	accountability: Accountability,
): Promise<Accountability | null> {
	const filterAuthentication = filterAuthentications.get(accountability);

	if (filterAuthentication === undefined) {
		return null;
	}

	return runAuthenticateFilter(
		createDefaultAccountability(filterAuthentication.accountabilityOverrides),
		filterAuthentication.message,
	);
}

// The accountability the filter set, or null when it left the default.
async function runAuthenticateFilter(
	defaultAccountability: Accountability,
	message: Record<string, any>,
): Promise<Accountability | null> {
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

	const filterLeftDefault = !customAccountability
		|| isEqual(customAccountability, defaultAccountability);

	if (filterLeftDefault) {
		return null;
	}

	return customAccountability;
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
