import knex from 'knex';
import { expect, test } from 'vitest';
import { getUserCountQuery } from './get-user-count-query.js';

// A user's role is the one `role` column of `directus_users` (#746).
test('counts the active users of the included roles but the excluded ids', () => {
	expect(getUserCountQuery(knex({ client: 'pg' }), {
		includeRoles: ['role-admin'],
		excludeIds: ['user-direct'],
	}).toString()).toEqual(
		'select count(*) as "count" from "directus_users"'
		+ ' where "status" = \'active\' and "id" not in (\'user-direct\')'
		+ ' and "role" in (\'role-admin\') limit 1',
	);
});

test('counts the active users out of the excluded roles', () => {
	expect(getUserCountQuery(knex({ client: 'pg' }), {
		includeRoles: ['role-app'],
		excludeRoles: ['role-admin'],
	}).toString()).toEqual(
		'select count(*) as "count" from "directus_users"'
		+ ' where "status" = \'active\' and "role" not in (\'role-admin\')'
		+ ' and "role" in (\'role-app\') limit 1',
	);
});

test('counts no user when no role is included', async () => {
	await expect(getUserCountQuery(knex({ client: 'pg' }), { includeRoles: [] }))
		.resolves.toEqual({ count: 0 });
});
