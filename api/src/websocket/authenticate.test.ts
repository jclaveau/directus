import { InvalidCredentialsError } from '@directus/errors';
import type { Accountability } from '@directus/types';
import type { Mock } from 'vitest';
import { describe, expect, test, vi } from 'vitest';
import emitter from '../emitter.js';
import { getAccountabilityForToken } from '../utils/get-accountability-for-token.js';
import { authenticateConnection, authenticationSuccess } from './authenticate.js';
import { customAccountabilities } from './memberships-changed.js';
import type { WebSocketAuthMessage } from './messages.js';
import { getExpiresAtForToken } from './utils/get-expires-at-for-token.js';

vi.mock('../utils/get-accountability-for-token', () => ({
	getAccountabilityForToken: vi.fn().mockReturnValue({
		user: null,
	} as Accountability),
}));

vi.mock('../emitter');

vi.mock('../utils/get-permissions', () => ({
	getPermissions: vi.fn(),
}));

vi.mock('./utils/get-expires-at-for-token', () => ({
	getExpiresAtForToken: vi.fn(),
}));

vi.mock('../utils/get-schema');

vi.mock('../services/authentication', () => ({
	AuthenticationService: vi.fn(function () {
		return {
			login: vi.fn().mockReturnValue({
				accessToken: '123',
				refreshToken: 'refresh',
				expires: 123456,
			}),
			refresh: vi.fn().mockReturnValue({
				accessToken: '456',
				refreshToken: 'refresh',
			}),
		};
	}),
}));

vi.mock('../database');

describe('authenticateConnection', () => {
	test('Success with email/password', async () => {
		const TIMESTAMP = 123456789;
		(getExpiresAtForToken as Mock).mockReturnValue(TIMESTAMP);

		const result = await authenticateConnection({
			type: 'auth',
			email: 'email',
			password: 'password',
		} as WebSocketAuthMessage);

		expect(result).toStrictEqual({
			accountability: { user: null },
			expires_at: TIMESTAMP,
			refresh_token: 'refresh',
		});
	});

	test('Success with refresh_token', async () => {
		const TIMESTAMP = 987654;
		(getExpiresAtForToken as Mock).mockReturnValue(TIMESTAMP);

		const result = await authenticateConnection({
			type: 'auth',
			refresh_token: 'refresh_token',
		} as WebSocketAuthMessage);

		expect(result).toStrictEqual({
			accountability: { user: null },
			expires_at: TIMESTAMP,
			refresh_token: 'refresh',
		});
	});

	test('Success with access_token', async () => {
		const TIMESTAMP = 456987;
		(getExpiresAtForToken as Mock).mockReturnValue(TIMESTAMP);

		const result = await authenticateConnection({
			type: 'auth',
			access_token: 'access_token',
		} as WebSocketAuthMessage);

		expect(result).toStrictEqual({
			accountability: { user: null },
			expires_at: TIMESTAMP,
			refresh_token: undefined,
		});
	});

	test('Marks a socket whose roles the authenticate filter changed', async () => {
		const TIMESTAMP = 456987;
		(getExpiresAtForToken as Mock).mockReturnValue(TIMESTAMP);

		const customAccountability = { admin: true };

		vi.mocked(emitter.emitFilter).mockResolvedValueOnce(customAccountability);

		const { accountability } = await authenticateConnection({
			type: 'auth',
			access_token: 'access_token',
		} as WebSocketAuthMessage);

		expect(accountability).toEqual(customAccountability);

		// A membership write closes its socket rather than refresh the filter's
		// roles.
		expect(
			customAccountabilities.has(customAccountability as Accountability),
		).toBe(true);
	});

	// A refresh recomputes only the roles: a socket whose filter left them keeps
	// what else the filter set, here its ip, and stays open.
	// The filter sets no connections, the token none either.
	test('Leaves unmarked a socket the filter only gave an ip', async () => {
		vi.mocked(getAccountabilityForToken).mockResolvedValueOnce({
			user: 'user-member',
			memberRoles: ['role-reader'],
			roles: ['role-reader'],
			admin: false,
			app: false,
			ip: null,
			grantedDbConnections: [],
		});

		const customAccountability = {
			user: 'user-member',
			memberRoles: ['role-reader'],
			roles: ['role-reader'],
			admin: false,
			app: false,
			ip: '203.0.113.7',
		};

		vi.mocked(emitter.emitFilter).mockResolvedValueOnce(customAccountability);

		const { accountability } = await authenticateConnection({
			type: 'auth',
			access_token: 'access_token',
		} as WebSocketAuthMessage);

		expect(accountability).toBe(customAccountability);

		expect(
			customAccountabilities.has(customAccountability as Accountability),
		).toBe(false);
	});

	// A refresh reads the memberships of the filter's user, not the token's.
	test('Marks a socket the filter gave another user of the same roles', async () => {
		vi.mocked(getAccountabilityForToken).mockResolvedValueOnce({
			user: 'user-token',
			memberRoles: ['role-reader'],
			roles: ['role-reader'],
			admin: false,
			app: false,
			ip: null,
		});

		const customAccountability = {
			user: 'user-service',
			memberRoles: ['role-reader'],
			roles: ['role-reader'],
			admin: false,
			app: false,
			ip: null,
		};

		vi.mocked(emitter.emitFilter).mockResolvedValueOnce(customAccountability);

		await authenticateConnection({
			type: 'auth',
			access_token: 'access_token',
		} as WebSocketAuthMessage);

		expect(
			customAccountabilities.has(customAccountability as Accountability),
		).toBe(true);
	});

	// A refresh recomputes the connections the roles grant.
	test('Marks a socket the filter granted other database connections', async () => {
		vi.mocked(getAccountabilityForToken).mockResolvedValueOnce({
			user: 'user-member',
			memberRoles: ['role-reader'],
			roles: ['role-reader'],
			admin: false,
			app: false,
			ip: null,
			grantedDbConnections: [],
		});

		const customAccountability = {
			user: 'user-member',
			memberRoles: ['role-reader'],
			roles: ['role-reader'],
			admin: false,
			app: false,
			ip: null,
			grantedDbConnections: ['replica'],
		};

		vi.mocked(emitter.emitFilter).mockResolvedValueOnce(customAccountability);

		await authenticateConnection({
			type: 'auth',
			access_token: 'access_token',
		} as WebSocketAuthMessage);

		expect(
			customAccountabilities.has(customAccountability as Accountability),
		).toBe(true);
	});

	// No roles to compare with: the filter's are all the socket has.
	test('Marks a socket whose token only the filter knows', async () => {
		vi.mocked(getAccountabilityForToken).mockRejectedValueOnce(
			new InvalidCredentialsError(),
		);

		const customAccountability = { user: 'user-external', roles: ['role-x'] };

		vi.mocked(emitter.emitFilter).mockResolvedValueOnce(customAccountability);

		const { accountability } = await authenticateConnection({
			type: 'auth',
			access_token: 'external-token',
		} as WebSocketAuthMessage);

		expect(accountability).toBe(customAccountability);

		expect(
			customAccountabilities.has(customAccountability as Accountability),
		).toBe(true);
	});

	test('Failure token expired', async () => {
		(getAccountabilityForToken as Mock).mockImplementation(() => {
			throw new InvalidCredentialsError();
		});

		await expect(() =>
			authenticateConnection({
				type: 'auth',
				access_token: 'expired',
			} as WebSocketAuthMessage),
		).rejects.toThrow('Authentication failed.');
	});

	test('Failure authentication failed', async () => {
		await expect(() =>
			authenticateConnection({
				type: 'auth',
				access_token: '',
			} as WebSocketAuthMessage),
		).rejects.toThrow('Authentication failed.');
	});
});

describe('authenticationSuccess', () => {
	test('without uid', async () => {
		const result = authenticationSuccess();
		expect(result).toBe('{"type":"auth","status":"ok"}');
	});

	test('with uid', async () => {
		const result = authenticationSuccess('123456');
		expect(result).toBe('{"type":"auth","status":"ok","uid":"123456"}');
	});
});
