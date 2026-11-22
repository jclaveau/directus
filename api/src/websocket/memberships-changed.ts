import type { Accountability } from '@directus/types';
import { useBus } from '../bus/index.js';
import getDatabase from '../database/index.js';
import { useLogger } from '../logger/index.js';
import {
	_fetchMemberRoles,
	fetchUserRoles,
} from '../permissions/lib/fetch-member-roles.js';
import {
	fetchGlobalAccess,
} from '../permissions/modules/fetch-global-access/fetch-global-access.js';
import { nodeId } from '../utils/node-id.js';
import { rerunAuthenticateFilter } from './authenticate.js';
import { WebSocketError } from './errors.js';
import type { WebSocketClient } from './types.js';

const MEMBERSHIPS_CHANGED_CHANNEL = 'membershipsChanged';

/**
 * The users whose memberships a write changed. `origin` names the node that
 * sent it: the bus hands a message back to its sender too, and that node
 * refreshed its own sockets before it sent.
 */
type MembershipsChangedMessage = {
	users: string[];
	origin: string;
};

const openClientSets = new Set<Set<WebSocketClient>>();

let busSubscribed = false;

// The latest refresh each socket started: an earlier one ending after it read
// the memberships before the later write, and is dropped.
const latestRefreshes = new WeakMap<WebSocketClient, symbol>();

const rolesRefreshedListeners = new Set<(client: WebSocketClient) => void>();

/**
 * Hears each socket whose roles a membership write refreshed, for a handler to
 * drop what the socket may no longer read.
 */
export function onSocketRolesRefreshed(
	listener: (client: WebSocketClient) => void,
): void {
	rolesRefreshedListeners.add(listener);
}

/**
 * Hands the sockets a controller holds open to the refresh a membership write
 * runs, and has this node hear the writes the other nodes make.
 */
export function refreshOnMembershipChange(
	openClients: Set<WebSocketClient>,
): void {
	openClientSets.add(openClients);

	if (busSubscribed) {
		return;
	}

	busSubscribed = true;

	useBus().subscribe<MembershipsChangedMessage>(
		MEMBERSHIPS_CHANGED_CHANNEL,
		async ({ users, origin }) => {
			if (origin !== nodeId) {
				await refreshSocketAccountabilities(users);
			}
		},
	);
}

/**
 * A socket authenticates once, and what its subscriptions hear is what the
 * roles it had then may read. A membership write recomputes the roles of the
 * sockets its users hold open, on this node before it answers and on every
 * other node once the bus reaches it, without closing them: the next event or
 * message a socket gets is read with the roles the user holds now. A socket
 * the `websocket.authenticate` filter let in has the filter run again, and
 * holds what it hands. A socket is closed, told why, only when it can no
 * longer be authenticated: its token expired, the filter refused it, or its
 * refresh failed.
 *
 * Never throws: it runs after the write committed.
 */
export async function announceMembershipsChanged(
	users: readonly string[],
): Promise<void> {
	const changedUsers = [...new Set(users)];

	if (changedUsers.length === 0) {
		return;
	}

	await refreshSocketAccountabilities(changedUsers);

	try {
		await useBus().publish<MembershipsChangedMessage>(
			MEMBERSHIPS_CHANGED_CHANNEL,
			{ users: changedUsers, origin: nodeId },
		);
	}
	catch (error) {
		useLogger().warn(
			error,
			'[websocket] could not tell the other nodes the memberships of '
				+ `${JSON.stringify(changedUsers)} changed: ${error}`,
		);
	}
}

async function refreshSocketAccountabilities(
	users: readonly string[],
): Promise<void> {
	for (const openClients of openClientSets) {
		for (const client of openClients) {
			const socketUser = client.accountability?.user;

			if (!socketUser || !users.includes(socketUser)) {
				continue;
			}

			// Past its expiry the token authenticates no one: the timer of the
			// controller may not have run yet.
			if (client.expires_at && client.expires_at * 1000 <= Date.now()) {
				closeSocket(
					client,
					'TOKEN_EXPIRED',
					socketUser,
					'the token of this socket expired',
				);

				continue;
			}

			const refreshMark = Symbol(socketUser);
			latestRefreshes.set(client, refreshMark);

			const accountability = client.accountability!;
			let filterAccountability: Accountability | null;

			try {
				filterAccountability = await rerunAuthenticateFilter(accountability);
			}
			// The filter no longer lets the socket in.
			catch (error) {
				useLogger().error(
					error,
					'[websocket] the "websocket.authenticate" filter refused the socket'
						+ ` of user ${JSON.stringify(socketUser)}: ${error}`,
				);

				closeSocket(
					client,
					'ROLES_REFRESH_FILTER_REFUSED',
					socketUser,
					'the "websocket.authenticate" filter refused this socket',
				);

				continue;
			}

			// Refreshed in place: a GraphQL subscription's service holds this
			// object, reading every event with it.
			try {
				const refreshed = filterAccountability
					?? await refreshedAccountability(accountability);

				if (latestRefreshes.get(client) === refreshMark) {
					Object.assign(accountability, refreshed);

					tellRolesRefreshedListeners(client, socketUser);
				}
			}
			// The roles it holds are no longer the user's: closed, it reconnects
			// and authenticates afresh.
			catch (error) {
				useLogger().error(
					error,
					'[websocket] could not refresh the roles of the socket of user '
						+ `${JSON.stringify(socketUser)}: ${error}`,
				);

				closeSocket(
					client,
					'ROLES_REFRESH_FAILED',
					socketUser,
					'the roles of this socket could not be refreshed',
				);
			}
		}
	}
}

function closeSocket(
	client: WebSocketClient,
	errorCode: string,
	socketUser: string,
	closeReason: string,
): void {
	client.send(new WebSocketError(
		'auth',
		errorCode,
		`The memberships of user ${JSON.stringify(socketUser)} changed and`
			+ ` ${closeReason}: reconnect to authenticate again.`,
	).toMessage());

	client.close();
}

// A failing listener is its own: the roles did refresh, the socket stays open.
function tellRolesRefreshedListeners(
	client: WebSocketClient,
	socketUser: string,
): void {
	for (const rolesRefreshedListener of rolesRefreshedListeners) {
		try {
			rolesRefreshedListener(client);
		}
		catch (error) {
			useLogger().error(
				error,
				'[websocket] a listener of the refreshed roles of the socket of'
					+ ` user ${JSON.stringify(socketUser)} failed: ${error}`,
			);
		}
	}
}

// The member roles read uncached: on another node the permissions cache may
// not have dropped them yet, its clear riding a channel of its own.
async function refreshedAccountability(
	accountability: Accountability,
): Promise<Accountability> {
	const database = getDatabase();

	const { memberRoles, roles } = await fetchUserRoles(
		accountability.user ?? null,
		database,
		_fetchMemberRoles,
	);

	const { admin, app, grantedDbConnections } = await fetchGlobalAccess(
		{ ...accountability, roles },
		database,
	);

	return {
		...accountability,
		memberRoles,
		roles,
		admin,
		app,
		grantedDbConnections,
	};
}
