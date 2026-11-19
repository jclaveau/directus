import { createInspector } from '@directus/schema';
import knex, { type Knex } from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import { randomUUID } from 'node:crypto';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { down, up } from './20261119B-add-role-members.js';

vi.mock('@directus/schema', () => {
	return { createInspector: vi.fn() };
});

vi.mock('node:crypto', () => {
	return { randomUUID: vi.fn() };
});

describe('the migration', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient, dialect: 'pg' });
		tracker = createTracker(db);
	});

	beforeEach(() => {
		tracker.on.any(/^(create|alter|drop) (table|index)/).response(undefined);
	});

	afterEach(() => {
		tracker.reset();
		vi.restoreAllMocks();
	});

	test('up turns the role of each user into one membership', async () => {
		vi.mocked(randomUUID)
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000002');

		vi.mocked(createInspector).mockReturnValue({
			foreignKeys: vi.fn().mockResolvedValue([
				{ column: 'avatar', constraint_name: 'directus_users_avatar_foreign' },
				{ column: 'role', constraint_name: 'directus_users_role_foreign' },
			]),
		} as any);

		tracker.on.select('directus_users').response([
			{ id: 'user-1', role: 'role-a' },
			{ id: 'user-2', role: 'role-b' },
		]);

		tracker.on.insert('directus_role_members').response([]);

		await up(db);

		expect(tracker.history.insert.map(({ bindings }) => bindings)).toEqual([
			[
				'00000000-0000-4000-8000-000000000001',
				'role-a',
				1,
				'user-1',
				'00000000-0000-4000-8000-000000000002',
				'role-b',
				1,
				'user-2',
			],
		]);

		expect(tracker.history.any.map(({ sql }) => sql).at(-2)).toEqual(
			'alter table "directus_users" drop constraint "directus_users_role_foreign"',
		);

		expect(tracker.history.any.map(({ sql }) => sql).at(-1)).toEqual(
			'alter table "directus_users" drop column "role"',
		);
	});

	test('up drops only the column when no foreign key is left on it', async () => {
		vi.mocked(createInspector).mockReturnValue({
			foreignKeys: vi.fn().mockResolvedValue([]),
		} as any);

		tracker.on.select('directus_users').response([]);

		await up(db);

		expect(tracker.history.insert).toEqual([]);

		expect(tracker.history.any.map(({ sql }) => sql).at(-1)).toEqual(
			'alter table "directus_users" drop column "role"',
		);

		expect(tracker.history.any.map(({ sql }) => sql)).not.toContain(
			'alter table "directus_users" drop constraint "directus_users_role_foreign"',
		);
	});

	test('up indexes the memberships by user', async () => {
		vi.mocked(createInspector).mockReturnValue({
			foreignKeys: vi.fn().mockResolvedValue([]),
		} as any);

		tracker.on.select('directus_users').response([]);

		await up(db);

		expect(tracker.history.any.map(({ sql }) => sql)).toContain(
			'create index "directus_role_members_user_index"'
			+ ' on "directus_role_members" ("user")',
		);
	});

	test('down gives each user the role of its one membership', async () => {
		tracker.on.select('directus_role_members').response([
			{ user: 'user-1', role: 'role-b' },
			{ user: 'user-2', role: 'role-c' },
		]);

		tracker.on.update('directus_users').response(1);

		await down(db);

		expect(tracker.history.update.map(({ bindings }) => bindings)).toEqual([
			['role-b', 'user-1'],
			['role-c', 'user-2'],
		]);

		expect(tracker.history.any.map(({ sql }) => sql).at(-1)).toEqual(
			'drop table "directus_role_members"',
		);
	});

	test('down rolls back a user holding one role twice', async () => {
		tracker.on.select('directus_role_members').response([
			{ user: 'user-1', role: 'role-b' },
			{ user: 'user-1', role: 'role-b' },
		]);

		tracker.on.update('directus_users').response(1);

		await down(db);

		expect(tracker.history.update.map(({ bindings }) => bindings)).toEqual([
			['role-b', 'user-1'],
		]);
	});

	test('down refuses users holding several roles, changing nothing', async () => {
		tracker.on.select('directus_role_members').response([
			{ user: 'user-1', role: 'role-b' },
			{ user: 'user-2', role: 'role-c' },
			{ user: 'user-1', role: 'role-a' },
			{ user: 'user-3', role: 'role-a' },
			{ user: 'user-3', role: 'role-c' },
		]);

		await expect(down(db)).rejects.toThrow(new Error(
			'Cannot roll back the multi-role migration: users "user-1", "user-3"'
			+ ' hold several roles; back up and remove the extra memberships first',
		));

		expect(tracker.history.select).toHaveLength(1);
		expect(tracker.history.insert).toEqual([]);
		expect(tracker.history.update).toEqual([]);
		expect(tracker.history.delete).toEqual([]);
		expect(tracker.history.any).toEqual([]);
	});
});
