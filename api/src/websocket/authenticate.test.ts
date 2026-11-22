import { InvalidCredentialsError } from '@directus/errors';
import type { Accountability } from '@directus/types';
import type { Mock } from 'vitest';
import { describe, expect, test, vi } from 'vitest';
import emitter from '../emitter.js';
import { getAccountabilityForToken } from '../utils/get-accountability-for-token.js';
import {
	authenticateConnection,
	authenticationSuccess,
	rerunAuthenticateFilter,
} from './authenticate.js';
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

	// A membership change runs the filter again on the socket it let in.
	test('Runs the filter again on what it saw, the password left out', async () => {
		const refreshedAccountability = {
			user: 'user-member',
			roles: ['role-press'],
			ip: '10.0.0.1',
		};

		vi.mocked(emitter.emitFilter)
			.mockResolvedValueOnce({
				user: 'user-member',
				roles: ['role-reader'],
				ip: '10.0.0.1',
			})
			.mockResolvedValueOnce(refreshedAccountability);

		const { accountability } = await authenticateConnection(
			{
				type: 'auth',
				email: 'email',
				password: 'password',
				uid: 'auth-1',
			} as WebSocketAuthMessage,
			{ ip: '10.0.0.1' },
		);

		await expect(rerunAuthenticateFilter(accountability))
			.resolves.toBe(refreshedAccountability);

		expect(emitter.emitFilter).toHaveBeenLastCalledWith(
			'websocket.authenticate',
			{
				user: null,
				memberRoles: [],
				roles: [],
				admin: false,
				app: false,
				ip: '10.0.0.1',
			},
			{ message: { type: 'auth', email: 'email', uid: 'auth-1' } },
			{ database: undefined, schema: null, accountability: null },
		);
	});

	test('Runs the filter again without the refresh token', async () => {
		const refreshedAccountability = { user: 'user-member', roles: [] };

		vi.mocked(emitter.emitFilter)
			.mockResolvedValueOnce({ user: 'user-member', roles: ['role-reader'] })
			.mockResolvedValueOnce(refreshedAccountability);

		const { accountability } = await authenticateConnection({
			type: 'auth',
			refresh_token: 'refresh_token',
		} as WebSocketAuthMessage);

		await expect(rerunAuthenticateFilter(accountability))
			.resolves.toBe(refreshedAccountability);

		expect(emitter.emitFilter).toHaveBeenLastCalledWith(
			'websocket.authenticate',
			{
				user: null,
				memberRoles: [],
				roles: [],
				admin: false,
				app: false,
				ip: null,
			},
			{ message: { type: 'auth' } },
			{ database: undefined, schema: null, accountability: null },
		);
	});

	// Its roles are the memberships a refresh reads.
	test('Answers null for a socket the filter left as is', async () => {
		vi.mocked(emitter.emitFilter).mockClear();

		const { accountability } = await authenticateConnection({
			type: 'auth',
			access_token: 'access_token',
		} as WebSocketAuthMessage);

		await expect(rerunAuthenticateFilter(accountability))
			.resolves.toBeNull();

		expect(emitter.emitFilter).toHaveBeenCalledOnce();
	});

	test('Answers null when the filter run again keeps the token\'s', async () => {
		vi.mocked(emitter.emitFilter)
			.mockResolvedValueOnce({ user: 'user-member', roles: ['role-reader'] })
			.mockImplementationOnce(async (_event, defaultAccountability) => {
				return defaultAccountability;
			});

		const { accountability } = await authenticateConnection({
			type: 'auth',
			access_token: 'ws-auth-narrow-member',
		} as WebSocketAuthMessage);

		await expect(rerunAuthenticateFilter(accountability))
			.resolves.toBeNull();
	});

	test('Throws the refusal of the filter run again', async () => {
		const refusal = new Error('ws-auth-narrow refuses the user "user-member"');

		vi.mocked(emitter.emitFilter)
			.mockResolvedValueOnce({ user: 'user-member', roles: ['role-reader'] })
			.mockRejectedValueOnce(refusal);

		const { accountability } = await authenticateConnection({
			type: 'auth',
			access_token: 'ws-auth-narrow-member',
		} as WebSocketAuthMessage);

		await expect(rerunAuthenticateFilter(accountability))
			.rejects.toBe(refusal);
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
