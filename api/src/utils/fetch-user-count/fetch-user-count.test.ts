import { oneLine } from '@directus/utils';
import type { Knex } from 'knex';
import { afterEach, expect, test, vi } from 'vitest';
import { fetchAccessLookup } from './fetch-access-lookup.js';
import { fetchAccessRoles } from './fetch-access-roles.js';
import { fetchUserCount } from './fetch-user-count.js';
import { getUserCountQuery } from './get-user-count-query.js';

vi.mock('./fetch-access-lookup.js');
vi.mock('./fetch-access-roles.js');
vi.mock('./get-user-count-query.js');

afterEach(() => {
	vi.resetAllMocks();
});

// A user holds one role (#746): users counted through a role are counted off
// `directus_users.role`, users given a policy directly one by one.
test(oneLine`
	counts the admins of a role and the admins given a policy directly
`, async () => {
	vi.mocked(fetchAccessLookup).mockResolvedValue([
		{
			role: 'role-admin',
			user: null,
			app_access: false,
			admin_access: true,
			user_status: 'active',
			user_role: null,
		},
		{
			role: null,
			user: 'user-direct',
			app_access: false,
			admin_access: true,
			user_status: 'active',
			user_role: 'role-plain',
		},
	]);

	vi.mocked(fetchAccessRoles).mockResolvedValue({
		adminRoles: new Set(['role-admin', 'role-admin-child']),
		appRoles: new Set(),
	});

	vi.mocked(getUserCountQuery).mockResolvedValue({ count: '2' });

	const knex = {} as Knex;

	await expect(fetchUserCount({
		adminOnly: true,
		excludeUsers: ['user-leaving'],
		knex,
	})).resolves.toEqual({ admin: 3, app: 0, api: 0 });

	expect(getUserCountQuery).toHaveBeenCalledWith(knex, {
		includeRoles: ['role-admin', 'role-admin-child'],
		excludeIds: ['user-direct', 'user-leaving'],
	});
});

test('counts app users out of the admin roles, the rest as api users', async () => {
	vi.mocked(fetchAccessLookup).mockResolvedValue([
		{
			role: 'role-admin',
			user: null,
			app_access: false,
			admin_access: true,
			user_status: 'active',
			user_role: null,
		},
		{
			role: 'role-app',
			user: null,
			app_access: true,
			admin_access: false,
			user_status: 'active',
			user_role: null,
		},
		{
			role: null,
			user: 'user-app-direct',
			app_access: true,
			admin_access: false,
			user_status: 'active',
			user_role: 'role-plain',
		},
		{
			role: null,
			user: 'user-app-in-admin-role',
			app_access: true,
			admin_access: false,
			user_status: 'active',
			user_role: 'role-admin',
		},
	]);

	vi.mocked(fetchAccessRoles).mockResolvedValue({
		adminRoles: new Set(['role-admin']),
		appRoles: new Set(['role-app']),
	});

	vi.mocked(getUserCountQuery)
		.mockResolvedValueOnce({ count: '1' })
		.mockResolvedValueOnce({ count: '4' })
		.mockResolvedValueOnce({ count: '10' });

	const knex = {} as Knex;

	await expect(fetchUserCount({ knex })).resolves.toEqual({
		admin: 1,
		app: 5,
		api: 4,
	});

	expect(vi.mocked(getUserCountQuery).mock.calls).toEqual([
		[
			knex,
			{
				includeRoles: ['role-admin'],
				excludeIds: [],
			},
		],
		[
			knex,
			{
				includeRoles: ['role-app'],
				excludeRoles: ['role-admin'],
				excludeIds: ['user-app-direct'],
			},
		],
		[
			knex,
			{ excludeIds: [] },
		],
	]);
});
