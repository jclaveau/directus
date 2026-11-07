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
			writeLog.push(query.sql);
		});

		emitter.onAction('activity.create', recordActivityAction);
		emitter.onAction('revisions.create', recordRevisionAction);
	});

	afterEach(async () => {
		emitter.offAction('activity.create', recordActivityAction);
		emitter.offAction('revisions.create', recordRevisionAction);
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
		])).rejects.toMatchObject({ code: 'NOT_NULL_VIOLATION' });

		await expect(database('directus_activity')).resolves.toStrictEqual([]);
		expect(writeLog).not.toContain('activity action');
		expect(writeLog).not.toContain('revision action');
	});

	it('fires both actions of a create after its commit', async () => {
		const service = new ItemsService('test', {
			knex: database,
			schema,
			accountability: admin,
		});

		await service.createOne({ id: 2, name: 'two' });

		expect(writeLog.slice(-3)).toStrictEqual([
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

		expect(writeLog.slice(-3)).toStrictEqual([
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

		expect(writeLog.slice(-2)).toStrictEqual([
			'COMMIT;',
			'activity action',
		]);
	});
});
