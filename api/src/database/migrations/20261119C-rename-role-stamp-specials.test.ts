import { createInspector } from '@directus/schema';
import knex, { type Knex } from 'knex';
import { createTracker, MockClient, type Tracker } from 'knex-mock-client';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	test,
	vi,
} from 'vitest';
import { down, up } from './20261119C-rename-role-stamp-specials.js';

const dialect = vi.hoisted(() => ({ client: 'postgres' }));
const logger = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock('@directus/schema', () => {
	return { createInspector: vi.fn() };
});

vi.mock('../index.js', () => {
	return { getDatabaseClient: () => dialect.client };
});

vi.mock('../../logger/index.js', () => ({ useLogger: () => logger }));

describe('the migration', () => {
	let db: Knex;
	let tracker: Tracker;

	beforeAll(() => {
		db = knex.default({ client: MockClient, dialect: 'pg' });
		tracker = createTracker(db);
	});

	beforeEach(() => {
		dialect.client = 'postgres';
		logger.info.mockReset();
		vi.mocked(createInspector).mockReset();
		tracker.on.any(/^alter table/).response(undefined);
		tracker.on.delete('directus_relations').response(1);
		tracker.on.insert('directus_relations').response([]);
		tracker.on.update('directus_fields').response(1);
	});

	afterEach(() => {
		tracker.reset();
		vi.restoreAllMocks();
	});

	test('up turns each role stamp into a json list of roles', async () => {
		vi.mocked(createInspector).mockReturnValue({
			foreignKeys: vi.fn().mockResolvedValue([
				{ column: 'author', constraint_name: 'articles_author_foreign' },
				{ column: 'made_by_role', constraint_name: 'articles_made_by_role_foreign' },
			]),
		} as any);

		tracker.on.select('directus_fields').response([
			{
				id: 3,
				collection: 'articles',
				field: 'made_by_role',
				special: 'role-created',
			},
			{ id: 4, collection: 'articles', field: 'title', special: 'cast-csv' },
			{
				id: 5,
				collection: 'articles',
				field: 'changed_by_role',
				special: 'cast-json,role-updated',
			},
		]);

		await up(db);

		expect(tracker.history.any.map(({ sql, bindings }) => ({ sql, bindings })))
			.toEqual([
				{
					sql: 'select "id", "collection", "field", "special" from'
						+ ' "directus_fields" where "special" is not null order by "id" asc',
					bindings: [],
				},
				{
					sql: 'alter table "articles" drop constraint'
						+ ' "articles_made_by_role_foreign"',
					bindings: [],
				},
				{
					sql: 'alter table "articles" alter column "made_by_role" type json'
						+ ' using case when "made_by_role" is null then null else'
						+ ' json_build_array("made_by_role") end',
					bindings: [],
				},
				{
					sql: 'delete from "directus_relations" where "many_collection" = $1'
						+ ' and "many_field" = $2',
					bindings: ['articles', 'made_by_role'],
				},
				{
					sql: 'update "directus_fields" set "special" = $1 where "id" = $2',
					bindings: ['roles-created,cast-json', 3],
				},
				{
					sql: 'alter table "articles" alter column "changed_by_role" type json'
						+ ' using case when "changed_by_role" is null then null else'
						+ ' json_build_array("changed_by_role") end',
					bindings: [],
				},
				{
					sql: 'delete from "directus_relations" where "many_collection" = $1'
						+ ' and "many_field" = $2',
					bindings: ['articles', 'changed_by_role'],
				},
				{
					sql: 'update "directus_fields" set "special" = $1 where "id" = $2',
					bindings: ['cast-json,roles-updated', 5],
				},
			]);

		expect(logger.info).toHaveBeenCalledWith(
			'Turned the role stamp fields "articles"."made_by_role",'
			+ ' "articles"."changed_by_role" into json lists of member roles,'
			+ ' dropping their relation to "directus_roles"',
		);
	});

	test('up changes nothing without a role stamp field', async () => {
		tracker.on.select('directus_fields').response([
			{
				id: 4,
				collection: 'articles',
				field: 'title',
				special: 'roles-created',
			},
		]);

		await up(db);

		expect(tracker.history.any).toHaveLength(1);
		expect(createInspector).not.toHaveBeenCalled();
		expect(logger.info).not.toHaveBeenCalled();
	});

	test('up refuses a database other than postgres', async () => {
		dialect.client = 'sqlite';

		tracker.on.select('directus_fields').response([
			{
				id: 3,
				collection: 'articles',
				field: 'made_by_role',
				special: 'role-created',
			},
			{
				id: 5,
				collection: 'notes',
				field: 'changed_by_role',
				special: 'role-updated',
			},
		]);

		await expect(up(db)).rejects.toEqual(new Error(
			'The role stamp fields "articles"."made_by_role",'
			+ ' "notes"."changed_by_role" can only be converted on postgres,'
			+ ' not on "sqlite"',
		));

		expect(tracker.history.any).toHaveLength(1);
	});

	test('down turns each list back into the uuid of its first role', async () => {
		tracker.on.select('directus_fields').response([
			{
				id: 3,
				collection: 'articles',
				field: 'made_by_role',
				special: 'roles-created,cast-json',
			},
		]);

		await down(db);

		expect(tracker.history.any.map(({ sql, bindings }) => ({ sql, bindings })))
			.toEqual([
				{
					sql: 'select "id", "collection", "field", "special" from'
						+ ' "directus_fields" where "special" is not null order by "id" asc',
					bindings: [],
				},
				{
					sql: 'alter table "articles" alter column "made_by_role" type uuid'
						+ ' using ("made_by_role" ->> 0)::uuid',
					bindings: [],
				},
				{
					sql: 'alter table "articles" add constraint'
						+ ' "articles_made_by_role_foreign" foreign key ("made_by_role")'
						+ ' references "directus_roles" ("id") on delete SET NULL',
					bindings: [],
				},
				{
					sql: 'insert into "directus_relations" ("many_collection",'
						+ ' "many_field", "one_collection") values ($1, $2, $3)',
					bindings: ['articles', 'made_by_role', 'directus_roles'],
				},
				{
					sql: 'update "directus_fields" set "special" = $1 where "id" = $2',
					bindings: ['role-created', 3],
				},
			]);

		expect(logger.info).toHaveBeenCalledWith(
			'Turned the role stamp fields "articles"."made_by_role" back into one'
			+ ' role uuid related to "directus_roles", keeping the first role of'
			+ ' each list',
		);
	});

	test('down changes nothing without a role list field', async () => {
		tracker.on.select('directus_fields').response([
			{
				id: 3,
				collection: 'articles',
				field: 'made_by_role',
				special: 'role-created',
			},
		]);

		await down(db);

		expect(tracker.history.any).toHaveLength(1);
		expect(logger.info).not.toHaveBeenCalled();
	});

	test('down refuses a database other than postgres', async () => {
		dialect.client = 'cockroachdb';

		tracker.on.select('directus_fields').response([
			{
				id: 3,
				collection: 'articles',
				field: 'made_by_role',
				special: 'roles-updated',
			},
		]);

		await expect(down(db)).rejects.toEqual(new Error(
			'The role stamp fields "articles"."made_by_role" can only be converted'
			+ ' on postgres, not on "cockroachdb"',
		));
	});
});
