import { SchemaBuilder } from '@directus/schema-builder';
import type { Accountability } from '@directus/types';
import knex, { type Knex } from 'knex';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import emitter from '../emitter.js';
import { ItemsService } from './items.js';

vi.mock('../../src/database/index', () => {
	return {
		default: vi.fn(),
		getDatabaseClient: vi.fn().mockReturnValue('sqlite'),
	};
});

vi.mock('../cache.js', () => {
	return {
		getCache: vi.fn().mockReturnValue({
			cache: null,
			systemCache: null,
			localSchemaCache: null,
			lockCache: null,
		}),
		getCacheValue: vi.fn(),
		setCacheValue: vi.fn(),
		clearSystemCache: vi.fn(),
	};
});

const schema = new SchemaBuilder()
	.collection('test', (c) => {
		c.field('id').id();
		c.field('name').string();
		c.field('author').m2o('authors');
	})
	.collection('authors', (c) => {
		c.field('id').id();
		c.field('name').string();
	})
	.collection('directus_activity', (c) => {
		c.field('id').id();
		c.field('action').string();
		c.field('user').string();
		c.field('collection').string();
		c.field('ip').string();
		c.field('user_agent').string();
		c.field('origin').string();
		c.field('item').string();
	})
	.collection('directus_revisions', (c) => {
		c.field('id').id();
		c.field('activity').integer();
		c.field('collection').string();
		c.field('item').string();
		c.field('data').json();
		c.field('delta').json();
		c.field('parent').integer();
	})
	.build();

schema.collections['test']!.accountability = 'all';
schema.collections['authors']!.accountability = 'all';
schema.collections['directus_activity']!.accountability = null;
schema.collections['directus_revisions']!.accountability = null;

const admin = {
	role: 'admin',
	user: 'admin-1',
	admin: true,
	app: false,
	roles: [],
	ip: null,
	userAgent: null,
	origin: null,
} as unknown as Accountability;

describe('Services / Items / activity and revision actions', () => {
	let database: Knex;
	let writeLog: string[];

	const recordActivityAction = () => {
		writeLog.push('activity action');
	};

	const recordRevisionAction = () => {
		writeLog.push('revision action');
	};

	const recordRevisionParentAction = () => {
		writeLog.push('revision parent action');
	};

	beforeAll(async () => {
		await import('../utils/get-service.js');
	}, 120_000);

	beforeEach(async () => {
		database = knex.default({
			client: 'sqlite3',
			connection: { filename: ':memory:' },
			useNullAsDefault: true,
			pool: { min: 1, max: 1 },
		});

		await database.schema.createTable('test', (table) => {
			table.increments('id');
			table.string('name').notNullable();
			table.integer('author');
		});

		await database.schema.createTable('authors', (table) => {
			table.increments('id');
			table.string('name');
		});

		await database.schema.createTable('directus_activity', (table) => {
			table.increments('id');
			table.string('action');
			table.string('user');
			table.string('collection');
			table.string('ip');
			table.string('user_agent');
			table.string('origin');
			table.string('item');
		});

		await database.schema.createTable('directus_revisions', (table) => {
			table.increments('id');
			table.integer('activity');
			table.string('collection');
			table.string('item');
			table.json('data');
			table.json('delta');
			table.integer('parent');
		});

		await database('test').insert({ id: 1, name: 'one' });

		writeLog = [];

		database.on('query', (query: { sql: string }) => {
			// up to the column list: which statement ran is what these tests read
			writeLog.push(query.sql.split(' (', 1)[0]!);
		});

		emitter.onAction('activity.create', recordActivityAction);
		emitter.onAction('revisions.create', recordRevisionAction);
		emitter.onAction('revisions.update', recordRevisionParentAction);
	});

	afterEach(async () => {
		emitter.offAction('activity.create', recordActivityAction);
		emitter.offAction('revisions.create', recordRevisionAction);
		emitter.offAction('revisions.update', recordRevisionParentAction);
		await database.destroy();
	});

	it('fires neither action of an upsert a later row rolled back', async () => {
		const service = new ItemsService('test', {
			knex: database,
			schema,
			accountability: admin,
		});

		await expect(service.upsertMany([
			{ id: 1, name: 'uno' },
			{ id: 1, name: null },
		])).rejects.toThrow(
			'Value for field "name" in collection "test" can\'t be null.',
		);

		expect(writeLog).toStrictEqual([
			'BEGIN;',
			'select `id` from `test` where `id` in',
			'update `test` set `name` = ? where `id` in',
			'insert into `directus_activity`',
			'select `test`.`id`, `test`.`name`, `test`.`author` from `test` where',
			'insert into `directus_revisions`',
			'select `id` from `test` where `id` in',
			'update `test` set `name` = ? where `id` in',
			'ROLLBACK',
		]);

		await expect(database('directus_activity')).resolves.toStrictEqual([]);
	});

	it('fires both actions of a create after its commit', async () => {
		const service = new ItemsService('test', {
			knex: database,
			schema,
			accountability: admin,
		});

		await service.createOne({ id: 2, name: 'two' });

		expect(writeLog).toStrictEqual([
			'BEGIN;',
			'insert into `test`',
			'insert into `directus_activity`',
			'insert into `directus_revisions`',
			'COMMIT;',
			'activity action',
			'revision action',
		]);
	});

	it('fires both actions of an update after its commit', async () => {
		const service = new ItemsService('test', {
			knex: database,
			schema,
			accountability: admin,
		});

		await service.updateOne(1, { name: 'uno' });

		expect(writeLog).toStrictEqual([
			'BEGIN;',
			'update `test` set `name` = ? where `id` in',
			'insert into `directus_activity`',
			'select `test`.`id`, `test`.`name`, `test`.`author` from `test` where',
			'insert into `directus_revisions`',
			'COMMIT;',
			'activity action',
			'revision action',
		]);
	});

	it('fires the activity action of a delete after its commit', async () => {
		const service = new ItemsService('test', {
			knex: database,
			schema,
			accountability: admin,
		});

		await service.deleteOne(1);

		expect(writeLog).toStrictEqual([
			'BEGIN;',
			expect.stringMatching(/^SAVEPOINT trx\d+;$/),
			'delete from `test` where `id` in',
			expect.stringMatching(/^RELEASE SAVEPOINT trx\d+;$/),
			'insert into `directus_activity`',
			'COMMIT;',
			'activity action',
		]);
	});

	it('fires no action of a create whose revision write rolled it back', async () => {
		await database.schema.dropTable('directus_revisions');

		await expect(new ItemsService('test', {
			knex: database,
			schema,
			accountability: admin,
		}).createOne({ id: 2, name: 'two' })).rejects.toThrow(
			'insert into `directus_revisions` '
			+ '(`activity`, `collection`, `data`, `delta`, `item`) values '
			+ '(1, \'test\', \'{"id":2,"name":"two"}\', '
			+ '\'{"id":2,"name":"two"}\', 2) returning `id` - '
			+ 'SQLITE_ERROR: no such table: directus_revisions',
		);

		expect(writeLog).toStrictEqual([
			'drop table `directus_revisions`',
			'BEGIN;',
			'insert into `test`',
			'insert into `directus_activity`',
			'insert into `directus_revisions`',
			'ROLLBACK',
		]);
	});

	it('fires the actions of a nested create after its commit', async () => {
		await new ItemsService('test', {
			knex: database,
			schema,
			accountability: admin,
		}).createOne({ id: 2, name: 'two', author: { name: 'ann' } });

		expect(writeLog).toStrictEqual([
			'BEGIN;',
			'insert into `authors`',
			'insert into `directus_activity`',
			'insert into `directus_revisions`',
			'insert into `test`',
			'insert into `directus_activity`',
			'insert into `directus_revisions`',
			'update `directus_revisions` set `parent` = ? where `id` in',
			'COMMIT;',
			'activity action',
			'revision action',
			'activity action',
			'revision action',
			'revision parent action',
		]);
	});

	it('fires the actions of a nested update after its commit', async () => {
		await new ItemsService('test', {
			knex: database,
			schema,
			accountability: admin,
		}).updateOne(1, { author: { name: 'ann' } });

		expect(writeLog).toStrictEqual([
			'BEGIN;',
			'insert into `authors`',
			'insert into `directus_activity`',
			'insert into `directus_revisions`',
			'update `test` set `author` = ? where `id` in',
			'insert into `directus_activity`',
			'select `test`.`id`, `test`.`name`, `test`.`author` from `test` where',
			'insert into `directus_revisions`',
			'update `directus_revisions` set `parent` = ? where `id` in',
			'COMMIT;',
			'activity action',
			'revision action',
			'activity action',
			'revision action',
			'revision parent action',
		]);
	});
});
