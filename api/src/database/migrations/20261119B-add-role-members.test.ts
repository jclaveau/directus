import { createInspector } from '@directus/schema';
import { oneLine } from '@directus/utils';
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

vi.mock('@directus/env', () => {
	return {
		useEnv: () => {
			return {
				AUTH_MOCKOAUTH_DRIVER: 'oauth2',
				AUTH_MOCKOAUTH_ROLE_MAPPING: { admins: 'role-b' },
				AUTH_GITHUB_DRIVER: 'oauth2',
				AUTH_KEYCLOAK_DRIVER: 'openid',
				AUTH_KEYCLOAK_ROLE_MAPPING: { admins: 'role-c' },
				AUTH_COMPANY_DRIVER: 'ldap',
				AUTH_COMPANY_GROUP_DN: 'ou=groups,dc=example,dc=com',
				AUTH_DIRECTORY_DRIVER: 'ldap',
				AUTH_OKTA_DRIVER: 'saml',
				// Never listed in AUTH_PROVIDERS: the password login.
				AUTH_DEFAULT_DRIVER: 'oauth2',
				AUTH_DEFAULT_ROLE_MAPPING: { admins: 'role-a' },
			};
		},
	};
});

describe('the migration', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient, dialect: 'pg' });
		tracker = createTracker(db);
	});

	beforeEach(() => {
		tracker.on.any(/^(create|alter|drop) (unique )?(table|index)/).response(undefined);

		tracker.on
			.select(/from "directus_(relations|permissions|presets|fields|operations|panels)"/)
			.response([]);
	});

	afterEach(() => {
		tracker.reset();
		vi.restoreAllMocks();
	});

	test('up turns each role into a membership, an SSO user\'s managed', async () => {
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
			{ id: 'user-1', role: 'role-a', provider: 'default' },
			{ id: 'user-2', role: 'role-b', provider: 'mockoauth' },
		]);

		tracker.on.insert('directus_role_members').response([]);

		await up(db);

		expect(tracker.history.insert.map(({ bindings }) => bindings)).toEqual([
			[
				'00000000-0000-4000-8000-000000000001',
				null,
				'role-a',
				1,
				'user-1',
				'00000000-0000-4000-8000-000000000002',
				'auth:mockoauth',
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

	// The next login of a provider mapping no role leaves the membership as is:
	// managed, no admin could ever take that role away.
	test('up manages only the memberships of a provider mapping roles', async () => {
		vi.mocked(randomUUID)
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000003')
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000004')
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000005')
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000006')
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000007');

		vi.mocked(createInspector).mockReturnValue({
			foreignKeys: vi.fn().mockResolvedValue([]),
		} as any);

		tracker.on.select('directus_users').response([
			{ id: 'user-1', role: 'role-a', provider: 'github' },
			{ id: 'user-2', role: 'role-b', provider: 'keycloak' },
			{ id: 'user-3', role: 'role-c', provider: 'company' },
			{ id: 'user-4', role: 'role-d', provider: 'directory' },
			{ id: 'user-5', role: 'role-e', provider: 'okta' },
			{ id: 'user-6', role: 'role-f', provider: 'default' },
			{ id: 'user-7', role: 'role-g', provider: null },
		]);

		tracker.on.insert('directus_role_members').response([]);

		await up(db);

		expect(tracker.history.insert.map(({ bindings }) => bindings)).toEqual([
			[
				'00000000-0000-4000-8000-000000000001',
				null,
				'role-a',
				1,
				'user-1',
				'00000000-0000-4000-8000-000000000002',
				'auth:keycloak',
				'role-b',
				1,
				'user-2',
				'00000000-0000-4000-8000-000000000003',
				'auth:company',
				'role-c',
				1,
				'user-3',
				'00000000-0000-4000-8000-000000000004',
				null,
				'role-d',
				1,
				'user-4',
				'00000000-0000-4000-8000-000000000005',
				null,
				'role-e',
				1,
				'user-5',
				'00000000-0000-4000-8000-000000000006',
				null,
				'role-f',
				1,
				'user-6',
				'00000000-0000-4000-8000-000000000007',
				null,
				'role-g',
				1,
				'user-7',
			],
		]);
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

	test('up records invites, one per email, role and inviter', async () => {
		vi.mocked(createInspector).mockReturnValue({
			foreignKeys: vi.fn().mockResolvedValue([]),
		} as any);

		tracker.on.select('directus_users').response([]);

		await up(db);

		expect(tracker.history.any.map(({ sql }) => sql)).toEqual(
			expect.arrayContaining([
				'create table "directus_invites" ("id" uuid,'
				+ ' "email" varchar(255) not null, "role" uuid not null,'
				+ ' "inviter" uuid null,'
				+ ' "date_created" timestamptz default CURRENT_TIMESTAMP,'
				+ ' constraint "directus_invites_pkey" primary key ("id"))',
				'alter table "directus_invites" add constraint'
				+ ' "directus_invites_role_foreign" foreign key ("role")'
				+ ' references "directus_roles" ("id") on delete CASCADE',
				'alter table "directus_invites" add constraint'
				+ ' "directus_invites_inviter_foreign" foreign key'
				+ ' ("inviter") references "directus_users" ("id")'
				+ ' on delete SET NULL',
				'create unique index "directus_invites_email_role_inviter_unique"'
				+ ' on "directus_invites" (lower("email"), "role",'
				+ ' coalesce("inviter", \'00000000-0000-0000-0000-000000000000\'))',
			]),
		);
	});

	test(oneLine`
		up turns an invited user into the invite to its role, then deletes it
	`, async () => {
		vi.mocked(randomUUID)
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000002');

		vi.mocked(createInspector).mockReturnValue({
			foreignKeys: vi.fn().mockResolvedValue([
				{
					table: 'directus_sessions',
					column: 'user',
					foreign_key_table: 'directus_users',
				},
				{
					table: 'directus_files',
					column: 'folder',
					foreign_key_table: 'directus_folders',
				},
			]),
		} as any);

		tracker.on.select('directus_users').response([
			{
				id: 'user-1',
				email: 'Ann@example.com',
				role: 'role-a',
				provider: 'default',
				status: 'invited',
			},
			{
				id: 'user-2',
				email: 'bob@example.com',
				role: 'role-b',
				provider: 'default',
				status: 'active',
			},
		]);

		tracker.on.select('directus_sessions').response([]);
		tracker.on.insert(/^insert into "directus_(role_members|invites)"/).response([]);
		tracker.on.delete('directus_users').response(1);

		await up(db);

		expect(tracker.history.select.map(({ sql, bindings }) => [sql, bindings]))
			.toEqual(expect.arrayContaining([
				[
					'select "id", "email", "role", "provider", "status"'
					+ ' from "directus_users" where "role" is not null'
					+ ' or "status" = $1',
					['invited'],
				],
				[
					'select distinct "user" from "directus_sessions"'
					+ ' where "user" in ($1)',
					['user-1'],
				],
			]));

		expect(tracker.history.insert.map(({ sql, bindings }) => [sql, bindings]))
			.toEqual([
				[
					'insert into "directus_role_members"'
					+ ' ("id", "managed_by", "role", "sort", "user")'
					+ ' values ($1, $2, $3, $4, $5)',
					['00000000-0000-4000-8000-000000000001', null, 'role-b', 1, 'user-2'],
				],
				[
					'insert into "directus_invites"'
					+ ' ("email", "id", "inviter", "role") values ($1, $2, $3, $4)',
					[
						'Ann@example.com',
						'00000000-0000-4000-8000-000000000002',
						null,
						'role-a',
					],
				],
			]);

		expect(tracker.history.delete.map(({ sql, bindings }) => [sql, bindings]))
			.toEqual([
				['delete from "directus_users" where "id" in ($1)', ['user-1']],
			]);
	});

	test(oneLine`
		up refuses invited users another record references, naming each, and
		changes nothing
	`, async () => {
		vi.mocked(createInspector).mockReturnValue({
			foreignKeys: vi.fn().mockResolvedValue([
				{
					table: 'directus_sessions',
					column: 'user',
					foreign_key_table: 'directus_users',
				},
				{
					table: 'articles',
					column: 'author',
					foreign_key_table: 'directus_users',
				},
			]),
		} as any);

		tracker.on.select('directus_users').response([
			{
				id: 'user-1',
				email: 'ann@example.com',
				role: 'role-a',
				provider: 'default',
				status: 'invited',
			},
			{
				id: 'user-2',
				email: 'bob@example.com',
				role: 'role-a',
				provider: 'default',
				status: 'invited',
			},
			{
				id: 'user-3',
				email: 'cleo@example.com',
				role: 'role-a',
				provider: 'default',
				status: 'invited',
			},
		]);

		tracker.on.select('directus_sessions').response([{ user: 'user-3' }]);
		tracker.on.select('articles').response([{ author: 'user-1' }]);

		await expect(up(db)).rejects.toThrow(new Error(
			'Cannot move the invited users into invites: users'
			+ ' "user-1" ("ann@example.com"), "user-3" ("cleo@example.com")'
			+ ' are referenced by other records; remove those references first',
		));

		expect(tracker.history.insert).toEqual([]);
		expect(tracker.history.delete).toEqual([]);
		expect(tracker.history.any).toEqual([]);
	});

	test(oneLine`
		up refuses an invited user with no role or no email, changing nothing
	`, async () => {
		vi.mocked(createInspector).mockReturnValue({
			foreignKeys: vi.fn().mockResolvedValue([]),
		} as any);

		tracker.on.select('directus_users').response([
			{
				id: 'user-1',
				email: 'ann@example.com',
				role: null,
				provider: 'default',
				status: 'invited',
			},
			{
				id: 'user-2',
				email: null,
				role: 'role-a',
				provider: 'default',
				status: 'invited',
			},
			{
				id: 'user-3',
				email: 'cleo@example.com',
				role: 'role-a',
				provider: 'default',
				status: 'invited',
			},
		]);

		await expect(up(db)).rejects.toThrow(new Error(
			'Cannot move the invited users into invites: users'
			+ ' "user-1" ("ann@example.com"), "user-2" (null)'
			+ ' have no email or no role; give them one or delete them first',
		));

		expect(tracker.history.select).toHaveLength(1);
		expect(tracker.history.any).toEqual([]);
	});

	test(oneLine`
		down turns each invited email back into an invited user of its role
	`, async () => {
		vi.mocked(randomUUID)
			.mockReturnValueOnce('00000000-0000-4000-8000-000000000001');

		tracker.on.select('directus_role_members').response([]);

		tracker.on.select('directus_invites').response([
			{ email: 'Ann@example.com', role: 'role-a' },
			{ email: 'ann@example.com', role: 'role-a' },
		]);

		tracker.on.select('directus_users').response([]);
		tracker.on.insert('directus_users').response([]);

		await down(db);

		expect(tracker.history.select.map(({ sql, bindings }) => [sql, bindings]))
			.toEqual(expect.arrayContaining([
				[
					'select "email", "role" from "directus_invites"'
					+ ' order by "date_created" asc, "id" asc',
					[],
				],
				[
					'select "email" from "directus_users"'
					+ ' where lower("email") in ($1)',
					['ann@example.com'],
				],
			]));

		expect(tracker.history.insert.map(({ sql, bindings }) => [sql, bindings]))
			.toEqual([
				[
					'insert into "directus_users" ("email", "id", "role", "status")'
					+ ' values ($1, $2, $3, $4)',
					[
						'Ann@example.com',
						'00000000-0000-4000-8000-000000000001',
						'role-a',
						'invited',
					],
				],
			]);
	});

	test(oneLine`
		down refuses an email invited to several roles, changing nothing
	`, async () => {
		tracker.on.select('directus_role_members').response([]);

		tracker.on.select('directus_invites').response([
			{ email: 'ann@example.com', role: 'role-a' },
			{ email: 'bob@example.com', role: 'role-a' },
			{ email: 'Ann@example.com', role: 'role-b' },
		]);

		await expect(down(db)).rejects.toThrow(new Error(
			'Cannot roll back the multi-role migration: emails "ann@example.com"'
			+ ' are invited to several roles; delete the extra invites first',
		));

		expect(tracker.history.insert).toEqual([]);
		expect(tracker.history.update).toEqual([]);
		expect(tracker.history.any).toEqual([]);
	});

	test(oneLine`
		down refuses an invited email holding an account, changing nothing
	`, async () => {
		tracker.on.select('directus_role_members').response([]);

		tracker.on.select('directus_invites').response([
			{ email: 'ann@example.com', role: 'role-a' },
			{ email: 'bob@example.com', role: 'role-a' },
		]);

		tracker.on.select('directus_users').response([{ email: 'Bob@example.com' }]);

		await expect(down(db)).rejects.toThrow(new Error(
			'Cannot roll back the multi-role migration: emails "bob@example.com"'
			+ ' are invited and hold an account; delete their invites first',
		));

		expect(tracker.history.insert).toEqual([]);
		expect(tracker.history.update).toEqual([]);
		expect(tracker.history.any).toEqual([]);
	});

	test('down drops the invites', async () => {
		tracker.on.select('directus_role_members').response([]);
		tracker.on.select('directus_invites').response([]);

		await down(db);

		expect(tracker.history.any.map(({ sql }) => sql).slice(-2)).toEqual([
			'drop table "directus_invites"',
			'drop table "directus_role_members"',
		]);
	});

	test('down gives each user the role of its one membership', async () => {
		tracker.on.select('directus_role_members').response([
			{ user: 'user-1', role: 'role-b' },
			{ user: 'user-2', role: 'role-c' },
		]);

		tracker.on.select('directus_invites').response([]);
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

	test('down sets the role of the users of a deleted role to null', async () => {
		tracker.on.select('directus_role_members').response([]);
		tracker.on.select('directus_invites').response([]);

		await down(db);

		expect(tracker.history.any.map(({ sql }) => sql)).toEqual(
			expect.arrayContaining([
				'alter table "directus_users" add constraint'
				+ ' "directus_users_role_foreign" foreign key ("role")'
				+ ' references "directus_roles" ("id") on delete SET NULL',
			]),
		);
	});

	test('down rolls back a user holding one role twice', async () => {
		tracker.on.select('directus_role_members').response([
			{ user: 'user-1', role: 'role-b' },
			{ user: 'user-1', role: 'role-b' },
		]);

		tracker.on.select('directus_invites').response([]);
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

describe('the stored paths to a user\'s role', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient, dialect: 'pg' });
		tracker = createTracker(db);
	});

	beforeEach(() => {
		tracker.on.any(/^(create|alter|drop) (unique )?(table|index)/).response(undefined);

		vi.mocked(createInspector).mockReturnValue({
			foreignKeys: vi.fn().mockResolvedValue([]),
		} as any);

		tracker.on.select('directus_relations').response([
			{
				many_collection: 'notes',
				many_field: 'by',
				one_collection: 'directus_users',
				one_field: null,
			},
			{
				many_collection: 'notes',
				many_field: 'item',
				one_collection: null,
				one_field: null,
			},
			{
				many_collection: 'directus_users',
				many_field: 'team',
				one_collection: 'teams',
				one_field: 'members',
			},
		]);
	});

	afterEach(() => {
		tracker.reset();
		vi.restoreAllMocks();
	});

	test('up moves a permission\'s filter, fields, preset to roles.role', async () => {
		tracker.on.select('directus_users').response([]);

		tracker.on.select('directus_permissions').response([
			{
				id: 1,
				collection: 'notes',
				permissions: '{"by":{"role":{"_in":"$CURRENT_MEMBER_ROLES"}}}',
				validation: null,
				presets: null,
				fields: '*',
			},
			{
				id: 2,
				collection: 'directus_users',
				permissions: { role: { name: { _eq: 'Editor' } } },
				validation: { email: { _nnull: true } },
				presets: { role: 'role-a', status: 'active' },
				fields: 'id,role,email',
			},
		]);

		tracker.on.select(/from "directus_(presets|fields|operations|panels)"/)
			.response([]);

		tracker.on.update('directus_permissions').response(1);

		await up(db);

		expect(tracker.history.update.map(({ sql, bindings }) => [sql, bindings]))
			.toEqual([
				[
					'update "directus_permissions" set "permissions" = $1'
					+ ' where "id" = $2',
					['{"by":{"roles":{"role":{"_in":"$CURRENT_MEMBER_ROLES"}}}}', 1],
				],
				[
					'update "directus_permissions" set "permissions" = $1'
					+ ' where "id" = $2',
					['{"roles":{"role":{"name":{"_eq":"Editor"}}}}', 2],
				],
				[
					'update "directus_permissions" set "presets" = $1'
					+ ' where "id" = $2',
					['{"status":"active","roles":[{"role":"role-a"}]}', 2],
				],
				[
					'update "directus_permissions" set "fields" = $1'
					+ ' where "id" = $2',
					['id,roles,email', 2],
				],
			]);
	});

	test('up moves the filters of a field\'s, a panel\'s options', async () => {
		tracker.on.select('directus_users').response([]);

		tracker.on.select('directus_fields').response([
			{
				id: 7,
				collection: 'notes',
				field: 'by',
				options: { filter: { role: { _eq: 'role-a' } } },
				conditions: null,
				validation: null,
			},
		]);

		tracker.on.select('directus_panels').response([
			{
				id: 'panel-1',
				options: {
					collection: 'directus_users',
					filter: { role: { _eq: 'role-a' } },
				},
			},
			{
				id: 'panel-2',
				options: { filter: { role: { _eq: 'role-a' } } },
			},
		]);

		tracker.on.select(/from "directus_(permissions|presets|operations)"/)
			.response([]);

		tracker.on.update(/^update "directus_(fields|panels)"/).response(1);

		await up(db);

		expect(tracker.history.update.map(({ sql, bindings }) => [sql, bindings]))
			.toEqual([
				[
					'update "directus_fields" set "options" = $1'
					+ ' where "id" = $2',
					['{"filter":{"roles":{"role":{"_eq":"role-a"}}}}', 7],
				],
				[
					'update "directus_panels" set "options" = $1'
					+ ' where "id" = $2',
					[
						'{"collection":"directus_users",'
						+ '"filter":{"roles":{"role":{"_eq":"role-a"}}}}',
						'panel-1',
					],
				],
			]);
	});

	test('up follows an o2m alias and a filter list', async () => {
		tracker.on.select('directus_users').response([]);

		tracker.on.select('directus_permissions').response([
			{
				id: 3,
				collection: 'teams',
				permissions: { members: { role: { _eq: 'role-a' } } },
				validation: null,
				presets: { role: 'role-a' },
				fields: null,
			},
			{
				id: 4,
				collection: 'notes',
				permissions: { _and: [{ by: { role: { _eq: 'role-a' } } }] },
				validation: null,
				presets: null,
				fields: null,
			},
		]);

		tracker.on.select('directus_panels').response([
			{ id: 'panel-3', options: 'not json' },
		]);

		tracker.on.select(/from "directus_(presets|fields|operations)"/)
			.response([]);

		tracker.on.update('directus_permissions').response(1);

		await up(db);

		expect(tracker.history.update.map(({ sql, bindings }) => [sql, bindings]))
			.toEqual([
				[
					'update "directus_permissions" set "permissions" = $1'
					+ ' where "id" = $2',
					['{"members":{"roles":{"role":{"_eq":"role-a"}}}}', 3],
				],
				[
					'update "directus_permissions" set "permissions" = $1'
					+ ' where "id" = $2',
					['{"_and":[{"by":{"roles":{"role":{"_eq":"role-a"}}}}]}', 4],
				],
			]);
	});

	test('down keeps a preset of no, several or a null membership', async () => {
		tracker.on.select('directus_role_members').response([]);
		tracker.on.select('directus_invites').response([]);

		tracker.on.select('directus_permissions').response([
			{
				id: 5,
				collection: 'directus_users',
				permissions: null,
				validation: null,
				presets: { status: 'active' },
				fields: null,
			},
			{
				id: 6,
				collection: 'directus_users',
				permissions: null,
				validation: null,
				presets: { roles: [{ role: 'role-a' }, { role: 'role-b' }] },
				fields: null,
			},
			{
				id: 7,
				collection: 'directus_users',
				permissions: null,
				validation: null,
				presets: { roles: [null] },
				fields: null,
			},
		]);

		tracker.on.select(/from "directus_(presets|fields|operations|panels)"/)
			.response([]);

		await down(db);

		expect(tracker.history.update).toEqual([]);
	});

	test('down moves them back to the role column', async () => {
		tracker.on.select('directus_role_members').response([]);
		tracker.on.select('directus_invites').response([]);

		tracker.on.select('directus_permissions').response([
			{
				id: 2,
				collection: 'directus_users',
				permissions: { roles: { role: { name: { _eq: 'Editor' } } } },
				validation: null,
				presets: { status: 'active', roles: [{ role: 'role-a' }] },
				fields: 'id,roles,email',
			},
		]);

		tracker.on.select(/from "directus_(presets|fields|operations|panels)"/)
			.response([]);

		tracker.on.update('directus_permissions').response(1);

		await down(db);

		expect(tracker.history.update.map(({ sql, bindings }) => [sql, bindings]))
			.toEqual([
				[
					'update "directus_permissions" set "permissions" = $1'
					+ ' where "id" = $2',
					['{"role":{"name":{"_eq":"Editor"}}}', 2],
				],
				[
					'update "directus_permissions" set "presets" = $1'
					+ ' where "id" = $2',
					['{"status":"active","role":"role-a"}', 2],
				],
				[
					'update "directus_permissions" set "fields" = $1'
					+ ' where "id" = $2',
					['id,role,email', 2],
				],
			]);
	});
});
