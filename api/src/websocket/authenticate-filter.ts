import type { Accountability } from '@directus/types';
import getDatabase from '../database/index.js';
import emitter from '../emitter.js';
import {
	createDefaultAccountability,
} from '../permissions/utils/create-default-accountability.js';
import { isEqual, omit } from '../utils/lodash-es-used.js';

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

export function keepFilterAuthentication(
	customAccountability: Accountability,
	message: Record<string, any>,
	accountabilityOverrides: Partial<Accountability> | undefined,
): void {
	filterAuthentications.set(customAccountability, {
		message: omit(message, ['password', 'refresh_token']),
		accountabilityOverrides,
	});
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

/**
 * The accountability the `websocket.authenticate` filter set, or null when it
 * left the default.
 */
export async function runAuthenticateFilter(
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
