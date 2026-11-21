import { oneLine } from '@directus/utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useBus } from '../bus/index.js';
import { useLogger } from '../logger/index.js';
import { fetchUserRoles } from '../permissions/lib/fetch-member-roles.js';
import {
	fetchGlobalAccess,
} from '../permissions/modules/fetch-global-access/fetch-global-access.js';
import type { WebSocketClient } from './types.js';

vi.mock('../utils/node-id.js', () => ({ nodeId: 'this-node' }));

vi.mock('../database/index.js', () => ({ default: () => 'database' }));

// Hoisted: each test imports the module afresh, and the mocks it reaches must
// be the ones the test asserts on.
const mocked = vi.hoisted(() => {
	return {
		bus: { publish: vi.fn(), subscribe: vi.fn() },
		logger: { warn: vi.fn(), error: vi.fn() },
		fetchUserRoles: vi.fn(),
		fetchGlobalAccess: vi.fn(),
	};
});

vi.mock('../bus/index.js', () => ({ useBus: () => mocked.bus }));

vi.mock('../logger/index.js', () => ({ useLogger: () => mocked.logger }));

vi.mock('../permissions/lib/fetch-member-roles.js', () => {
	return {
		_fetchMemberRoles: 'uncached',
		fetchUserRoles: mocked.fetchUserRoles,
	};
});

vi.mock(
	'../permissions/modules/fetch-global-access/fetch-global-access.js',
	() => ({ fetchGlobalAccess: mocked.fetchGlobalAccess }),
);

let memberships: typeof import('./memberships-changed.js');

beforeEach(async () => {
	vi.resetModules();
	memberships = await import('./memberships-changed.js');

	vi.mocked(fetchUserRoles).mockResolvedValue({
		memberRoles: ['role-press'],
		roles: ['role-staff', 'role-press'],
	});

	vi.mocked(fetchGlobalAccess).mockResolvedValue({
		admin: false,
		app: true,
		grantedDbConnections: [],
	} as any);
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('announceMembershipsChanged', () => {
	it(`recomputes the roles of the listed users' sockets, and tells the peers`, async () => {
		const memberSocket = {
			accountability: {
				user: 'user-member',
				roles: ['role-editors'],
				memberRoles: ['role-editors'],
				admin: false,
				app: false,
				ip: '10.0.0.1',
			},
		} as unknown as WebSocketClient;

		const otherSocket = {
			accountability: { user: 'user-other', roles: ['role-editors'] },
		} as unknown as WebSocketClient;

		const publicSocket = { accountability: null } as unknown as WebSocketClient;
		const memberAccountability = memberSocket.accountability;

		memberships.refreshOnMembershipChange(
			new Set([memberSocket, otherSocket, publicSocket]),
		);

		await memberships.announceMembershipsChanged(['user-member', 'user-member']);

		// A GraphQL subscription's service holds the object it had.
		expect(memberSocket.accountability).toBe(memberAccountability);

		expect(memberSocket.accountability).toStrictEqual({
			user: 'user-member',
			roles: ['role-staff', 'role-press'],
			memberRoles: ['role-press'],
			admin: false,
			app: true,
			grantedDbConnections: [],
			ip: '10.0.0.1',
		});

		expect(otherSocket.accountability).toStrictEqual({
			user: 'user-other',
			roles: ['role-editors'],
		});

		expect(fetchUserRoles)
			.toHaveBeenCalledExactlyOnceWith('user-member', 'database', 'uncached');

		expect(fetchGlobalAccess).toHaveBeenCalledExactlyOnceWith(
			{
				user: 'user-member',
				roles: ['role-staff', 'role-press'],
				memberRoles: ['role-editors'],
				admin: false,
				app: false,
				ip: '10.0.0.1',
			},
			'database',
		);

		expect(useBus().publish).toHaveBeenCalledExactlyOnceWith(
			'membershipsChanged',
			{ users: ['user-member'], origin: 'this-node' },
		);
	});

	it('sends nothing when no user changed', async () => {
		await memberships.announceMembershipsChanged([]);

		expect(useBus().publish).not.toHaveBeenCalled();
	});

	it(oneLine`
		closes a socket whose refresh failed, telling it why, and logs it
	`, async () => {
		const refusal = new Error('Connection terminated');
		vi.mocked(fetchUserRoles).mockRejectedValueOnce(refusal);

		const memberSocket = {
			accountability: { user: 'user-member', roles: ['role-editors'] },
			send: vi.fn(),
			close: vi.fn(),
		};

		memberships.refreshOnMembershipChange(
			new Set([memberSocket as unknown as WebSocketClient]),
		);

		await memberships.announceMembershipsChanged(['user-member']);

		expect(memberSocket.send).toHaveBeenCalledExactlyOnceWith(JSON.stringify({
			type: 'auth',
			status: 'error',
			error: {
				code: 'ROLES_REFRESH_FAILED',
				message: 'The memberships of user "user-member" changed and the'
					+ ' roles of this socket could not be refreshed: reconnect to'
					+ ' authenticate again.',
			},
		}));

		expect(memberSocket.close).toHaveBeenCalledExactlyOnceWith();

		expect(useLogger().error).toHaveBeenCalledExactlyOnceWith(
			refusal,
			'[websocket] could not refresh the roles of the socket of user'
				+ ' "user-member": Error: Connection terminated',
		);

		expect(useBus().publish).toHaveBeenCalledOnce();
	});

	it('logs a publish the bus refused, and answers', async () => {
		const refusal = new Error('ECONNREFUSED');
		vi.mocked(useBus().publish).mockRejectedValueOnce(refusal);

		await expect(memberships.announceMembershipsChanged(['user-member']))
			.resolves.toBeUndefined();

		expect(useLogger().warn).toHaveBeenCalledExactlyOnceWith(
			refusal,
			'[websocket] could not tell the other nodes the memberships of'
				+ ' ["user-member"] changed: Error: ECONNREFUSED',
		);
	});
});

describe('refreshOnMembershipChange', () => {
	it('subscribes once for every controller', () => {
		memberships.refreshOnMembershipChange(new Set());
		memberships.refreshOnMembershipChange(new Set());

		expect(useBus().subscribe).toHaveBeenCalledExactlyOnceWith(
			'membershipsChanged',
			expect.any(Function),
		);
	});

	it(`refreshes the sockets of the users another node changed`, async () => {
		const memberSocket = {
			accountability: { user: 'user-member', roles: ['role-editors'] },
		} as unknown as WebSocketClient;

		memberships.refreshOnMembershipChange(new Set([memberSocket]));
		const [[, onMessage]] = vi.mocked(useBus().subscribe).mock.calls as any;

		await onMessage({ users: ['user-member'], origin: 'other-node' });

		expect(memberSocket.accountability).toStrictEqual({
			user: 'user-member',
			roles: ['role-staff', 'role-press'],
			memberRoles: ['role-press'],
			admin: false,
			app: true,
			grantedDbConnections: [],
		});
	});

	it('skips the message this node sent, having refreshed before', async () => {
		const memberSocket = {
			accountability: { user: 'user-member', roles: ['role-editors'] },
		} as unknown as WebSocketClient;

		memberships.refreshOnMembershipChange(new Set([memberSocket]));
		const [[, onMessage]] = vi.mocked(useBus().subscribe).mock.calls as any;

		await onMessage({ users: ['user-member'], origin: 'this-node' });

		expect(memberSocket.accountability).toStrictEqual({
			user: 'user-member',
			roles: ['role-editors'],
		});

		expect(fetchUserRoles).not.toHaveBeenCalled();
	});
});
