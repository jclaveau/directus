import type { Knex } from 'knex';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { _fetchMemberRoles, fetchUserRoles } from './fetch-member-roles.js';
import { fetchRolesTree } from './fetch-roles-tree.js';

vi.mock('../utils/with-cache.js', () => {
	return {
		withCache: (_namespace: string, handler: unknown) => handler,
	};
});

vi.mock('./fetch-roles-tree.js', () => {
	return { fetchRolesTree: vi.fn() };
});

let knex: Knex;

beforeEach(() => {
	vi.resetAllMocks();

	knex = {
		select: vi.fn().mockReturnThis(),
		from: vi.fn().mockReturnThis(),
		where: vi.fn().mockReturnThis(),
		orderBy: vi.fn(),
	} as unknown as Knex;
});

describe('_fetchMemberRoles', () => {
	test('returns no role, and reads nothing, for no user', async () => {
		await expect(_fetchMemberRoles(null, knex)).resolves.toEqual([]);

		expect(knex.select).not.toHaveBeenCalled();
	});

	test('returns the roles of the memberships in the order read', async () => {
		vi.mocked(knex.orderBy as any).mockResolvedValue([
			{ role: 'role-b' },
			{ role: 'role-a' },
		]);

		await expect(_fetchMemberRoles('user-1', knex)).resolves
			.toEqual(['role-b', 'role-a']);

		expect(knex.select).toHaveBeenCalledWith('role');
		expect(knex.from).toHaveBeenCalledWith('directus_role_members');
		expect(knex.where).toHaveBeenCalledWith({ user: 'user-1' });

		expect(knex.orderBy).toHaveBeenCalledWith([
			{ column: 'sort', nulls: 'first' },
			'id',
		]);
	});

	test('counts a role granted by two memberships once', async () => {
		vi.mocked(knex.orderBy as any).mockResolvedValue([
			{ role: 'role-a' },
			{ role: 'role-b' },
			{ role: 'role-a' },
		]);

		await expect(_fetchMemberRoles('user-1', knex)).resolves
			.toEqual(['role-a', 'role-b']);
	});
});

describe('fetchUserRoles', () => {
	test('returns nothing for no user', async () => {
		await expect(fetchUserRoles(null, knex)).resolves
			.toEqual({ memberRoles: [], roles: [] });

		expect(fetchRolesTree).not.toHaveBeenCalled();
	});

	test('chains member roles after their ancestors, shared ones once', async () => {
		vi.mocked(knex.orderBy as any).mockResolvedValue([
			{ role: 'role-b' },
			{ role: 'role-c' },
		]);

		vi.mocked(fetchRolesTree)
			.mockResolvedValueOnce(['root', 'role-b'])
			.mockResolvedValueOnce(['root', 'role-c']);

		await expect(fetchUserRoles('user-1', knex)).resolves.toEqual({
			memberRoles: ['role-b', 'role-c'],
			roles: ['root', 'role-b', 'role-c'],
		});

		expect(fetchRolesTree).toHaveBeenNthCalledWith(1, 'role-b', knex);
		expect(fetchRolesTree).toHaveBeenNthCalledWith(2, 'role-c', knex);
	});
});
