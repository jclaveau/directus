import knex from 'knex';
import { expect, test } from 'vitest';
import { getUserCountQuery } from './get-user-count-query.js';

// A user's roles are its rows of `directus_role_members` (#746).
test('counts active users in the included roles, but the excluded ids', () => {
	expect(getUserCountQuery(knex({ client: 'pg' }), {
		includeRoles: ['role-admin'],
		excludeIds: ['user-direct'],
	}).toString()).toEqual(
		'select count(*) as "count" from "directus_users"'
		+ ' where "status" = \'active\' and "id" not in (\'user-direct\')'
		+ ' and exists (select 1 from "directus_role_members"'
		+ ' where "directus_role_members"."user" = "directus_users"."id"'
		+ ' and "directus_role_members"."role" in (\'role-admin\')) limit 1',
	);
});

test('counts the active users with no membership in the excluded roles', () => {
	expect(getUserCountQuery(knex({ client: 'pg' }), {
		includeRoles: ['role-app', 'role-app-child'],
		excludeRoles: ['role-admin'],
	}).toString()).toEqual(
		'select count(*) as "count" from "directus_users"'
		+ ' where "status" = \'active\' and not exists (select 1'
		+ ' from "directus_role_members"'
		+ ' where "directus_role_members"."user" = "directus_users"."id"'
		+ ' and "directus_role_members"."role" in (\'role-admin\'))'
		+ ' and exists (select 1 from "directus_role_members"'
		+ ' where "directus_role_members"."user" = "directus_users"."id"'
		+ ' and "directus_role_members"."role" in (\'role-app\', \'role-app-child\'))'
		+ ' limit 1',
	);
});

test('counts every active user when no role is given', () => {
	expect(getUserCountQuery(knex({ client: 'pg' }), {}).toString()).toEqual(
		'select count(*) as "count" from "directus_users"'
		+ ' where "status" = \'active\' limit 1',
	);
});

test('counts no user when no role is included', async () => {
	await expect(getUserCountQuery(knex({ client: 'pg' }), { includeRoles: [] }))
		.resolves.toEqual({ count: 0 });
});
