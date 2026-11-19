import knex, { type Knex } from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';
import { down, up } from './20261119E-unique-role-members.js';

describe('the migration', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient, dialect: 'pg' });
		tracker = createTracker(db);
	});

	afterEach(() => {
		tracker.reset();
	});

	test('up makes a role held twice from one manager impossible', async () => {
		tracker.on.select('directus_role_members').response([]);
		tracker.on.any(/^create unique index/).response(undefined);

		await up(db);

		expect(tracker.history.any.map(({ sql }) => sql).at(-1)).toEqual(
			'create unique index "directus_role_members_user_role_managed_by_unique"'
			+ ' on "directus_role_members"'
			+ ' ("user", "role", coalesce("managed_by", \'\'))',
		);
	});

	test('up refuses, naming the rows, while a role is held twice', async () => {
		tracker.on.select('directus_role_members').response([
			{ id: 'member-1', user: 'user-1', role: 'role-a', managed_by: null },
			{ id: 'member-2', user: 'user-1', role: 'role-a', managed_by: null },
			{ id: 'member-3', user: 'user-1', role: 'role-a', managed_by: 'invite:x' },
			{ id: 'member-4', user: 'user-2', role: 'role-b', managed_by: 'invite:x' },
			{ id: 'member-5', user: 'user-2', role: 'role-b', managed_by: 'invite:x' },
		]);

		await expect(up(db)).rejects.toThrow(new Error(
			'Cannot make a role held once per manager: directus_role_members rows'
			+ ' "member-1", "member-2" give user "user-1" the role "role-a" with'
			+ ' managed_by null; rows "member-4", "member-5" give user "user-2" the'
			+ ' role "role-b" with managed_by "invite:x"; delete the extra rows'
			+ ' first',
		));

		expect(tracker.history.any.map(({ sql }) => sql))
			.not.toContainEqual(expect.stringMatching(/^create unique index/));
	});

	test('down drops the unique index', async () => {
		tracker.on.any(/^drop index/).response(undefined);

		await down(db);

		expect(tracker.history.any.map(({ sql }) => sql)).toEqual([
			'drop index "directus_role_members_user_role_managed_by_unique"',
		]);
	});
});
