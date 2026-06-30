import knex, { type Knex } from 'knex';
import { MockClient, createTracker, type Tracker } from 'knex-mock-client';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type MockedFunction,
} from 'vitest';

const env: Record<string, any> = {
	CACHE_SCHEMA: false,
	CACHE_SCHEMA_MAX_ITERATIONS: 100,
	CACHE_SCHEMA_SYNC_TIMEOUT: 10000,
	DB_EXCLUDE_TABLES: [],
};

vi.mock('@directus/env', () => {
	return { useEnv: () => env };
});

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('postgres'),
	};
});

// createInspector().overview() is the column/primary source; stub a single user
// collection so the assembly loop (144-189) and the fields loop (215-252) both run.
const overview = vi.fn();

vi.mock('@directus/schema', () => {
	return {
		createInspector: () => {
			return { overview };
		},
	};
});

// readAll is only reached at the very end; an empty relation set keeps the focus on
// the collections/fields assembly.
const readAll = vi.fn().mockResolvedValue([]);

vi.mock('../services/relations.js', () => {
	return {
		RelationsService: vi.fn().mockImplementation(() => {
			return { readAll };
		}),
	};
});

const { getSchema } = await import('./get-schema.js');

function overviewFor(collection: string) {
	return {
		[collection]: {
			primary: 'id',
			columns: {
				id: {
					column_name: 'id',
					data_type: 'integer',
					is_nullable: false,
					is_generated: false,
				},
				student: {
					column_name: 'student',
					data_type: 'varchar',
					is_nullable: true,
					is_generated: false,
				},
			},
		},
	};
}

describe('getDatabaseSchema (via getSchema bypassCache)', () => {
	let db: MockedFunction<Knex>;
	let tracker: Tracker;

	beforeAll(() => {
		db = vi.mocked(knex.default({ client: MockClient }));
		tracker = createTracker(db);
	});

	beforeEach(() => {
		overview.mockReset();
		readAll.mockClear();
	});

	afterEach(() => {
		tracker.reset();
	});

	function run() {
		return getSchema({ database: db, bypassCache: true });
	}

	// Postgres returns the JSON column already parsed as an array; parseJsonFieldList
	// passes it straight through, so scopedCacheFields is populated.
	it('assembles a collection with a Postgres-style (pre-parsed array) scoped_cache_fields', async () => {
		overview.mockResolvedValue(overviewFor('test'));

		tracker.on.select('directus_collections').response([
			{
				collection: 'test',
				singleton: false,
				note: 'a note',
				sort_field: 'sort',
				accountability: 'all',
				scoped_cache_fields: ['student'],
			},
		]);

		tracker.on.select('directus_fields').response([
			{
				id: 1,
				collection: 'test',
				field: 'id',
				special: null,
				note: null,
				validation: null,
			},
		]);

		const schema = await run();
		const test = schema.collections['test'];

		expect(test).toBeDefined();
		expect(test!.scopedCacheFields).toEqual(['student']);
		expect(test!.primary).toBe('id');
		expect(test!.note).toBe('a note');
		expect(test!.sortField).toBe('sort');
		expect(test!.singleton).toBe(false);
		// The assembly loop maps every overview column into a field.
		expect(Object.keys(test!.fields).sort()).toEqual(['id', 'student']);
		expect(test!.fields['id']!.type).toBe('integer');
		expect(test!.fields['id']!.dbType).toBe('integer');
		expect(readAll).toHaveBeenCalledOnce();
	});

	// MySQL/SQLite return the JSON column as a string; parseJsonFieldList must parse it.
	it('parses a MySQL-style (JSON string) scoped_cache_fields through parseJsonFieldList', async () => {
		overview.mockResolvedValue(overviewFor('test'));

		tracker.on.select('directus_collections').response([
			{
				collection: 'test',
				singleton: 1,
				note: null,
				sort_field: null,
				accountability: 'all',
				scoped_cache_fields: '["student"]',
			},
		]);

		tracker.on.select('directus_fields').response([]);

		const schema = await run();
		const test = schema.collections['test'];

		expect(test!.scopedCacheFields).toEqual(['student']);
		// singleton stored as 1 must normalize to true.
		expect(test!.singleton).toBe(true);
	});

	// A collection with no meta row falls back to accountability:'all' and an empty
	// scoped-cache list (parseJsonFieldList(undefined) → []).
	it('falls back to defaults when no collection meta row exists', async () => {
		overview.mockResolvedValue(overviewFor('orphan'));

		tracker.on.select('directus_collections').response([]);
		tracker.on.select('directus_fields').response([]);

		const schema = await run();
		const orphan = schema.collections['orphan'];

		expect(orphan).toBeDefined();
		expect(orphan!.accountability).toBe('all');
		expect(orphan!.scopedCacheFields).toEqual([]);
	});

	// The assembly loop skips collections that are excluded, lack a primary key, or have
	// a space in the name (146-158); none of them reach result.collections.
	it('skips excluded / no-primary / spaced collections', async () => {
		env['DB_EXCLUDE_TABLES'] = ['excluded'];

		overview.mockResolvedValue({
			excluded: { primary: 'id', columns: {} },
			nopk: { primary: null, columns: {} },
			'has space': { primary: 'id', columns: {} },
			kept: {
				primary: 'id',
				columns: { id: { column_name: 'id', data_type: 'integer', is_nullable: false } },
			},
		});

		tracker.on.select('directus_collections').response([]);
		tracker.on.select('directus_fields').response([]);

		const schema = await run();

		env['DB_EXCLUDE_TABLES'] = [];

		expect(Object.keys(schema.collections)).toEqual(['kept']);
	});

	// An existing column field with a string validation goes through parseJSON (234-236).
	it('parses a string validation on an existing field', async () => {
		overview.mockResolvedValue(overviewFor('test'));

		tracker.on.select('directus_collections').response([
			{
				collection: 'test',
				singleton: false,
				note: null,
				sort_field: null,
				accountability: 'all',
				scoped_cache_fields: null,
			},
		]);

		tracker.on.select('directus_fields').response([
			{
				id: 1,
				collection: 'test',
				field: 'student',
				special: null,
				note: null,
				validation: '{"_and":[]}',
			},
		]);

		const schema = await run();

		const validation = schema.collections['test']!.fields['student']!.validation;
		expect(validation).toEqual({ _and: [] });
	});

	// A field row carrying an alias special with no matching column produces an alias
	// field, exercising the fields loop's alias path (215-252).
	it('maps an alias field row onto the collection', async () => {
		overview.mockResolvedValue(overviewFor('test'));

		tracker.on.select('directus_collections').response([
			{
				collection: 'test',
				singleton: false,
				note: null,
				sort_field: null,
				accountability: 'all',
				scoped_cache_fields: null,
			},
		]);

		tracker.on.select('directus_fields').response([
			{
				id: 1,
				collection: 'test',
				field: 'children',
				special: 'o2m',
				note: 'kids',
				validation: null,
			},
		]);

		const schema = await run();
		const test = schema.collections['test'];

		expect(test!.fields['children']).toBeDefined();
		expect(test!.fields['children']!.type).toBe('alias');
		expect(test!.fields['children']!.note).toBe('kids');
		expect(test!.fields['children']!.special).toEqual(['o2m']);
	});
});
