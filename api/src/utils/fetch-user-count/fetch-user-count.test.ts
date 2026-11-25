import { oneLine } from '@directus/utils';
import knex from 'knex';
import { createTracker, MockClient } from 'knex-mock-client';
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

// A user holds several roles (#746): users counted through a role are counted
// off their `directus_role_members` rows, users given a policy directly one by one.
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
		},
		{
			role: null,
			user: 'user-direct',
			app_access: false,
			admin_access: true,
			user_status: 'active',
		},
	]);

	vi.mocked(fetchAccessRoles).mockResolvedValue({
		adminRoles: new Set(['role-admin', 'role-admin-child']),
		appRoles: new Set(),
	});

	vi.mocked(getUserCountQuery).mockResolvedValue({ count: '2' });

	const database = knex.default({ client: MockClient });

	await expect(fetchUserCount({
		adminOnly: true,
		excludeUsers: ['user-leaving'],
		knex: database,
	})).resolves.toEqual({ admin: 3, app: 0, api: 0 });

	expect(getUserCountQuery).toHaveBeenCalledWith(database, {
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
		},
		{
			role: 'role-app',
			user: null,
			app_access: true,
			admin_access: false,
			user_status: 'active',
		},
		{
			role: null,
			user: 'user-app-direct',
			app_access: true,
			admin_access: false,
			user_status: 'active',
		},
		{
			role: null,
			user: 'user-app-in-admin-role',
			app_access: true,
			admin_access: false,
			user_status: 'active',
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

	const database = knex.default({ client: MockClient });

	createTracker(database).on.select('directus_role_members')
		.response([{ user: 'user-app-in-admin-role' }]);

	await expect(fetchUserCount({ knex: database })).resolves.toEqual({
		admin: 1,
		app: 5,
		api: 4,
	});

	expect(vi.mocked(getUserCountQuery).mock.calls).toEqual([
		[
			database,
			{
				includeRoles: ['role-admin'],
				excludeIds: [],
			},
		],
		[
			database,
			{
				includeRoles: ['role-app'],
				excludeRoles: ['role-admin'],
				excludeIds: ['user-app-direct'],
			},
		],
		[
			database,
			{ excludeIds: [] },
		],
	]);
});

test('asks which directly granted app users also sit in an admin role', async () => {
	vi.mocked(fetchAccessLookup).mockResolvedValue([
		{
			role: null,
			user: 'user-app-direct',
			app_access: true,
			admin_access: false,
			user_status: 'active',
		},
	]);

	vi.mocked(fetchAccessRoles).mockResolvedValue({
		adminRoles: new Set(['role-admin', 'role-admin-child']),
		appRoles: new Set(),
	});

	vi.mocked(getUserCountQuery).mockResolvedValue({ count: '0' });

	const database = knex.default({ client: MockClient });
	const tracker = createTracker(database);

	tracker.on.select('directus_role_members').response([]);

	await expect(fetchUserCount({ knex: database })).resolves.toEqual({
		admin: 0,
		app: 1,
		api: 0,
	});

	expect(tracker.history.select[0]!.bindings).toEqual([
		'user-app-direct',
		'role-admin',
		'role-admin-child',
	]);
});

test('asks nothing of the memberships when no admin role exists', async () => {
	vi.mocked(fetchAccessLookup).mockResolvedValue([
		{
			role: null,
			user: 'user-app-direct',
			app_access: true,
			admin_access: false,
			user_status: 'active',
		},
	]);

	vi.mocked(fetchAccessRoles).mockResolvedValue({
		adminRoles: new Set(),
		appRoles: new Set(),
	});

	vi.mocked(getUserCountQuery).mockResolvedValue({ count: '0' });

	const database = knex.default({ client: MockClient });
	const tracker = createTracker(database);

	tracker.on.select('directus_role_members').response([]);

	await expect(fetchUserCount({ knex: database })).resolves.toEqual({
		admin: 0,
		app: 1,
		api: 0,
	});

	expect(tracker.history.select).toEqual([]);
});
