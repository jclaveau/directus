import { oneLine } from '@directus/utils';
import type { Knex } from 'knex';
import { afterEach, expect, test, vi } from 'vitest';
import { fetchUserCount } from '../../../utils/fetch-user-count/fetch-user-count.js';
import type { Context } from '../../types.js';
import { validateRemainingAdminUsers } from './validate-remaining-admin-users.js';

vi.mock('../../../utils/fetch-user-count/fetch-user-count.js');

afterEach(() => {
	vi.resetAllMocks();
});

test(oneLine`
	refuses a change that leaves no admin, counting without the removed
	role
`, async () => {
	vi.mocked(fetchUserCount).mockResolvedValue({ admin: 0, app: 0, api: 0 });

	const knex = {} as Knex;

	await expect(validateRemainingAdminUsers(
		{ excludeRoles: ['role-admin'] },
		{ knex } as Context,
	)).rejects.toMatchObject({
		status: 422,
		message: oneLine`
			Can't process content. Cannot remove the last admin user from the
			system.
		`,
	});

	expect(fetchUserCount).toHaveBeenCalledWith({
		excludeRoles: ['role-admin'],
		adminOnly: true,
		knex,
	});
});

test('accepts a change that leaves one admin', async () => {
	vi.mocked(fetchUserCount).mockResolvedValue({ admin: 1, app: 0, api: 0 });

	await expect(validateRemainingAdminUsers(
		{ excludeUsers: ['user-leaving'] },
		{ knex: {} as Knex } as Context,
	)).resolves.toBeUndefined();
});
