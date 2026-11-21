import jwt from 'jsonwebtoken';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import getDatabase from '../database/index.js';
import { getAccountabilityForToken } from './get-accountability-for-token.js';
import { fetchGlobalAccess } from '../permissions/modules/fetch-global-access/fetch-global-access.js';
import { fetchUserRoles } from '../permissions/lib/fetch-member-roles.js';

vi.mock('@directus/env', () => {
	return {
		useEnv: vi.fn().mockReturnValue({ SECRET: 'super-secure-secret' }),
	};
});

vi.mock('../permissions/modules/fetch-global-access/fetch-global-access.js');
vi.mock('../permissions/lib/fetch-member-roles.js');

vi.mock('../database/index', () => {
	const self: Record<string, any> = {
		select: vi.fn(() => self),
		from: vi.fn(() => self),
		leftJoin: vi.fn(() => self),
		where: vi.fn(() => self),
		first: vi.fn(),
	};

	return { default: vi.fn(() => self) };
});

beforeEach(() => {
	vi.clearAllMocks();
});

describe('getAccountabilityForToken', async () => {
	test('minimal token payload', async () => {
		const db = getDatabase();

		vi.mocked(fetchUserRoles).mockResolvedValue({ memberRoles: [], roles: [] });

		vi.mocked(fetchGlobalAccess).mockResolvedValue({
			app: false,
			admin: false,
			grantedDbConnections: [],
		});

		const expectedAccountability = {
			admin: false,
			app: false,
			memberRoles: [],
			roles: [],
			ip: null,
			user: null,
			grantedDbConnections: [],
		};

		const result = await getAccountabilityForToken(jwt.sign(
			{ app_access: false, admin_access: false },
			'super-secure-secret',
			{ issuer: 'directus' },
		));

		expect(result).toStrictEqual(expectedAccountability);
		expect(fetchUserRoles).toHaveBeenCalledWith(null, db);
		expect(fetchGlobalAccess).toHaveBeenCalledWith(expectedAccountability, db);
	});

	test('full token payload', async () => {
		const token = jwt.sign(
			{
				share: 'share-id',
				id: 'user-id',
				admin_access: 1,
				app_access: 1,
			},
			'super-secure-secret',
			{ issuer: 'directus' },
		);

		vi.mocked(fetchUserRoles).mockResolvedValue({
			memberRoles: ['role-id'],
			roles: ['parent-id', 'role-id'],
		});

		vi.mocked(fetchGlobalAccess).mockResolvedValue({
			app: true,
			admin: true,
			grantedDbConnections: ['premium'],
		});

		const result = await getAccountabilityForToken(token);

		expect(fetchUserRoles).toHaveBeenCalledWith('user-id', getDatabase());

		expect(result).toStrictEqual({
			admin: true,
			app: true,
			user: 'user-id',
			memberRoles: ['role-id'],
			roles: ['parent-id', 'role-id'],
			ip: null,
			share: 'share-id',
			grantedDbConnections: ['premium'],
		});
	});

	test('throws token expired error', async () => {
		const token = jwt.sign({ id: 'user-id' }, 'super-secure-secret', {
			issuer: 'directus',
			expiresIn: -1,
		});

		await expect(() => getAccountabilityForToken(token)).rejects.toThrow('Token expired.');
	});

	test('throws token invalid error', async () => {
		const token = jwt.sign({ id: 'user-id' }, 'bad-secret', { issuer: 'directus' });
		await expect(() => getAccountabilityForToken(token)).rejects.toThrow('Invalid token.');
	});

	test('find user in database', async () => {
		const db = getDatabase();

		vi.spyOn(db, 'first').mockReturnValue({
			id: 'user-id',
		} as any);

		vi.mocked(fetchUserRoles).mockResolvedValue({
			memberRoles: ['role-id'],
			roles: ['role-id'],
		});

		vi.mocked(fetchGlobalAccess).mockResolvedValue({
			app: true,
			admin: false,
			grantedDbConnections: [],
		});

		const token = jwt.sign({ id: 'user-id' }, 'bad-secret');

		const expectedAccountability = {
			user: 'user-id',
			memberRoles: ['role-id'],
			roles: ['role-id'],
			admin: false,
			app: true,
			ip: null,
			grantedDbConnections: [],
		};

		const result = await getAccountabilityForToken(token);

		expect(result).toStrictEqual(expectedAccountability);

		expect(fetchUserRoles).toHaveBeenCalledWith('user-id', db);
		expect(fetchGlobalAccess).toHaveBeenCalledWith(expectedAccountability, db);
	});

	test('no user found', async () => {
		const db = getDatabase();
		vi.spyOn(db, 'first').mockReturnValue(false as any);
		const token = jwt.sign({ id: 'user-id' }, 'bad-secret');
		await expect(() => getAccountabilityForToken(token)).rejects.toThrow('Invalid user credentials.');
	});
});
