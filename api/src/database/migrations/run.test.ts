import type { Knex } from 'knex';
import knex from 'knex';
import { createTracker, MockClient, Tracker } from 'knex-mock-client';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
	type MockedFunction,
	vi,
} from 'vitest';
import run from './run.js';

describe('run', () => {
	let db: MockedFunction<Knex>;
	let tracker: Tracker;

	beforeAll(() => {
		db = vi.mocked(knex.default({ client: MockClient }));
		tracker = createTracker(db);
	});

	afterEach(() => {
		tracker.reset();
	});

	describe('when passed the argument up', () => {
		it('returns "Nothing To Upgrade" if no directus_migrations', async () => {
			tracker.on.select('directus_migrations').response(['Empty']);

			await run(db, 'up').catch((e: Error) => {
				expect(e).toBeInstanceOf(Error);
				expect(e.message).toBe('Nothing to upgrade');
			});
		});

		it('returns "Method implemented in the dialect driver" if no directus_migrations', async () => {
			tracker.on.select('directus_migrations').response([]);

			await run(db, 'up').catch((e: Error) => {
				expect(e).toBeInstanceOf(Error);
				expect(e.message).toBe('Method implemented in the dialect driver');
			});
		});

		it('returns undefined if the migration is successful', async () => {
			tracker.on.select('directus_migrations').response([
				{
					version: '20201028A',
					name: 'Remove Collection Foreign Keys',
					timestamp: '2021-11-27 11:36:56.471595-05',
				},
			]);

			tracker.on.delete('directus_relations').response([]);
			tracker.on.insert('directus_migrations').response(['Remove System Relations', '20201029A']);

			expect(await run(db, 'up')).toBe(undefined);
		});
	});

	describe('when passed the argument down', () => {
		it('returns "Nothing To downgrade" if no valid directus_migrations', async () => {
			tracker.on.select('directus_migrations').response(['Empty']);

			await run(db, 'down').catch((e: Error) => {
				expect(e).toBeInstanceOf(Error);
				expect(e.message).toBe(`Couldn't find migration`);
			});
		});

		it('returns "Method implemented in the dialect driver" if no directus_migrations', async () => {
			tracker.on.select('directus_migrations').response([]);

			await run(db, 'down').catch((e: Error) => {
				expect(e).toBeInstanceOf(Error);
				expect(e.message).toBe('Nothing to downgrade');
			});
		});

		it(`returns "Couldn't find migration" if an invalid migration object is supplied`, async () => {
			tracker.on.select('directus_migrations').response([
				{
					version: '202018129A',
					name: 'Fake Migration',
					timestamp: '2020-00-32 11:36:56.471595-05',
				},
			]);

			await run(db, 'down').catch((e: Error) => {
				expect(e).toBeInstanceOf(Error);
				expect(e.message).toBe(`Couldn't find migration`);
			});
		});
	});

	describe('when passed the argument latest', () => {
		it('returns "Nothing To downgrade" if no valid directus_migrations', async () => {
			tracker.on.select('directus_migrations').response(['Empty']);

			await run(db, 'latest').catch((e: Error) => {
				expect(e).toBeInstanceOf(Error);
				expect(e.message).toBe(`Method implemented in the dialect driver`);
			});
		});

		it('returns "Method implemented in the dialect driver" if no directus_migrations', async () => {
			tracker.on.select('directus_migrations').response([]);

			await run(db, 'latest').catch((e: Error) => {
				expect(e).toBeInstanceOf(Error);
				expect(e.message).toBe('Method implemented in the dialect driver');
			});
		});
	});

	describe('when migration keys collide', () => {
		afterEach(() => {
			vi.doUnmock('fs-extra');
			vi.resetModules();
		});

		it('throws an error listing the colliding version and its files', async () => {
			vi.resetModules();

			vi.doMock('fs-extra', () => ({
				default: {
					readdir: vi.fn().mockResolvedValue(['20201028A-first.js', '20201028A-second.js']),
					pathExists: vi.fn().mockResolvedValue(false),
				},
			}));

			const { default: runWithCollision } = await import('./run.js');

			tracker.on.select('directus_migrations').response([]);

			const error = await runWithCollision(db, 'up').catch((e: Error) => e);

			expect(error).toBeInstanceOf(Error);
			expect((error as Error).message).toContain('Migration keys collide!');
			expect((error as Error).message).toContain('"20201028A"');
			expect((error as Error).message).toContain('first.js');
			expect((error as Error).message).toContain('second.js');
		});

		it('formats each collision as a tab-dashed line listing comma-separated files', async () => {
			vi.resetModules();

			vi.doMock('fs-extra', () => ({
				default: {
					readdir: vi.fn().mockResolvedValue(['20201028A-first.js', '20201028A-second.js']),
					pathExists: vi.fn().mockResolvedValue(false),
				},
			}));

			const { default: runWithCollision } = await import('./run.js');

			tracker.on.select('directus_migrations').response([]);

			const error = await runWithCollision(db, 'up').catch((e: Error) => e);

			expect((error as Error).message).toMatch(
				/\n\t- "20201028A": [^\n]*20201028A-[a-z]+\.js, [^\n]*20201028A-[a-z]+\.js/,
			);
		});

		it('lists every colliding version when several versions collide', async () => {
			vi.resetModules();

			vi.doMock('fs-extra', () => ({
				default: {
					readdir: vi
						.fn()
						.mockResolvedValue([
							'20201028A-first.js',
							'20201028A-second.js',
							'20201029B-third.js',
							'20201029B-fourth.js',
						]),
					pathExists: vi.fn().mockResolvedValue(false),
				},
			}));

			const { default: runWithCollision } = await import('./run.js');

			tracker.on.select('directus_migrations').response([]);

			const error = await runWithCollision(db, 'up').catch((e: Error) => e);

			const message = (error as Error).message;

			expect(message).toContain('"20201028A"');
			expect(message).toContain('"20201029B"');
			// one line per colliding version
			expect(message.match(/\n\t- "/g)).toHaveLength(2);
		});

		it('does not report a collision when every version is unique', async () => {
			vi.resetModules();

			vi.doMock('fs-extra', () => ({
				default: {
					readdir: vi.fn().mockResolvedValue(['20201028A-first.js', '20201029B-second.js']),
					pathExists: vi.fn().mockResolvedValue(false),
				},
			}));

			const { default: runWithCollision } = await import('./run.js');

			tracker.on.select('directus_migrations').response([]);

			const result = await runWithCollision(db, 'up').catch((e: Error) => e);

			if (result instanceof Error) {
				expect(result.message).not.toContain('Migration keys collide!');
			}
		});
	});

	describe('transaction scopes', () => {
		let directory: string;
		let databaseFile: string;
		let client: string;

		const flushCaches = vi.fn();
		const warn = vi.fn();

		beforeEach(async () => {
			client = 'postgres';
			// `mockClear` would keep a rejection set by one case and leak it into the
			// next; the runner also `.catch()`es the result, so it has to be a promise.
			flushCaches.mockReset();
			flushCaches.mockResolvedValue(undefined);
			warn.mockReset();
			directory = await mkdtemp(join(tmpdir(), 'directus-migrations-'));
			databaseFile = join(directory, 'probe.sqlite');
		});

		afterEach(async () => {
			vi.doUnmock('fs-extra');
			vi.doUnmock('@directus/env');
			vi.doUnmock('../../cache.js');
			vi.doUnmock('../index.js');
			vi.doUnmock('../../logger/index.js');
			vi.resetModules();
			await rm(directory, { recursive: true, force: true });
		});

		/**
		 * The runner reads its own directory and `MIGRATIONS_PATH`, then imports
		 * each file by absolute path. Emptying the first and pointing the second
		 * at a temp directory lets a test drive real migration modules through a
		 * real driver, so what follows asserts on what the database ended up
		 * holding rather than on calls to a mock.
		 */
		async function runFixtures(
			files: Record<string, string>,
			options: { direction?: 'up' | 'down' | 'latest'; completed?: string[] } = {},
		) {
			for (const [name, source] of Object.entries(files)) {
				await writeFile(join(directory, name), source);
			}

			vi.resetModules();

			vi.doMock('fs-extra', () => {
				return {
					default: {
						readdir: vi.fn(async (target: string) => {
							if (target === directory) {
								return Object.keys(files);
							}

							return [];
						}),
						pathExists: vi.fn(async (target: string) => target === directory),
					},
				};
			});

			vi.doMock('@directus/env', () => {
				return { useEnv: () => ({ MIGRATIONS_PATH: directory }) };
			});

			vi.doMock('../../cache.js', () => {
				return { flushCaches };
			});

			vi.doMock('../../logger/index.js', () => {
				return {
					useLogger: () => {
						return { info: vi.fn(), warn, error: vi.fn() };
					},
				};
			});

			vi.doMock('../index.js', () => {
				// The suite drives a real sqlite file because it is the only engine a unit
				// test can open, but sqlite is not one the runner wraps. Naming the client
				// keeps these cases about the batching logic rather than the dialect gate,
				// which has its own case below.
				return { getDatabaseClient: () => client };
			});

			const database = knex.default({
				client: 'sqlite3',
				connection: { filename: databaseFile },
				useNullAsDefault: true,
				pool: { min: 1, max: 1 },
			});

			await database.schema.createTable('directus_migrations', (table) => {
				table.string('version');
				table.string('name');
				table.timestamp('timestamp').defaultTo(database.fn.now());
			});

			for (const version of options.completed ?? []) {
				await database
					.insert({ version, name: version })
					.into('directus_migrations');
			}

			const { default: runFresh } = await import('./run.js');

			const error = await runFresh(
				database,
				options.direction ?? 'latest',
				false,
			).catch((e: Error) => e);

			const applied = await database
				.select('version')
				.from('directus_migrations')
				.orderBy('version');

			const hasTable = (name: string) => database.schema.hasTable(name);

			const tables = {
				first: await hasTable('probe_first'),
				second: await hasTable('probe_second'),
				inTransaction: await hasTable('probe_in_transaction'),
				outsideTransaction: await hasTable('probe_outside_transaction'),
			};

			await database.destroy();

			return { error, applied: applied.map(({ version }) => version), tables };
		}

		function scopedTo(scope: string, body: string) {
			return `export const transactionScope = '${scope}';\n${body}`;
		}

		const createsFirst = `export async function up(knex) {
			await knex.schema.createTable('probe_first', (t) => t.integer('id'));
		}`;

		const createsSecond = `export async function up(knex) {
			await knex.schema.createTable('probe_second', (t) => t.integer('id'));
		}`;

		// Names its table after the connection it was handed, so a scope meant to
		// run outside the run's transaction cannot pass by receiving one anyway.
		const recordsItsConnection = `export async function up(knex) {
			const kind = knex.isTransaction ? 'in' : 'outside';
			await knex.schema.createTable(\`probe_\${kind}_transaction\`, (t) => {
				t.integer('id');
			});
		}`;

		const throws = `export async function up() {
			throw new Error('migration failed');
		}`;

		it('applies every pending migration and records each version', async () => {
			const { error, applied, tables } = await runFixtures({
				'20990101A-first.js': createsFirst,
				'20990102A-second.js': createsSecond,
			});

			expect(error).toBeUndefined();
			expect(applied).toEqual(['20990101A', '20990102A']);
			expect(tables.first).toBe(true);
			expect(tables.second).toBe(true);
		});

		it('runs a migration declaring no scope inside the transaction', async () => {
			const { error, applied, tables } = await runFixtures({
				'20990101A-first.js': recordsItsConnection,
			});

			expect(error).toBeUndefined();
			expect(applied).toEqual(['20990101A']);
			expect(tables.inTransaction).toBe(true);
			expect(tables.outsideTransaction).toBe(false);
		});

		it('rolls back an earlier migration when a later one fails', async () => {
			const { error, applied, tables } = await runFixtures({
				'20990101A-first.js': createsFirst,
				'20990102A-boom.js': throws,
			});

			expect((error as Error).message).toBe('migration failed');
			expect(applied).toEqual([]);
			expect(tables.first).toBe(false);
		});

		it('keeps an "own" migration when a later one fails', async () => {
			const { error, applied, tables } = await runFixtures({
				'20990101A-first.js': scopedTo('own', recordsItsConnection),
				'20990102A-boom.js': throws,
			});

			expect((error as Error).message).toBe('migration failed');
			expect(applied).toEqual(['20990101A']);
			expect(tables.inTransaction).toBe(true);
			expect(tables.outsideTransaction).toBe(false);
		});

		it('runs a "none" migration outside any transaction', async () => {
			const { error, applied, tables } = await runFixtures({
				'20990101A-first.js': scopedTo('none', recordsItsConnection),
				'20990102A-boom.js': throws,
			});

			expect((error as Error).message).toBe('migration failed');
			expect(applied).toEqual(['20990101A']);
			expect(tables.outsideTransaction).toBe(true);
			expect(tables.inTransaction).toBe(false);
		});

		it('runs a single "up" inside the transaction as well', async () => {
			const { error, applied, tables } = await runFixtures(
				{ '20990101A-first.js': recordsItsConnection },
				{ direction: 'up' },
			);

			expect(error).toBeUndefined();
			expect(applied).toEqual(['20990101A']);
			expect(tables.inTransaction).toBe(true);
			expect(tables.outsideTransaction).toBe(false);
		});

		it('records no version when a single "up" fails', async () => {
			const { error, applied } = await runFixtures(
				{ '20990101A-boom.js': throws },
				{ direction: 'up' },
			);

			expect((error as Error).message).toBe('migration failed');
			expect(applied).toEqual([]);
		});

		it('runs a single "down" inside the transaction', async () => {
			const { error, applied, tables } = await runFixtures(
				{
					'20990101A-first.js': `export async function up() {}\n${
						recordsItsConnection.replace('function up(', 'function down(')
					}`,
				},
				{ direction: 'down', completed: ['20990101A'] },
			);

			expect(error).toBeUndefined();
			expect(applied).toEqual([]);
			expect(tables.inTransaction).toBe(true);
			expect(tables.outsideTransaction).toBe(false);
		});

		it('refuses a migration declaring an unknown scope, naming it', async () => {
			const { error, applied } = await runFixtures({
				'20990101A-first.js': scopedTo('nonne', createsFirst),
			});

			expect((error as Error).message).toContain('20990101A-first.js');
			expect((error as Error).message).toContain('nonne');
			expect(applied).toEqual([]);
		});

		it('flushes caches when an escape committed before a failure', async () => {
			const { error } = await runFixtures({
				'20990101A-first.js': scopedTo('own', createsFirst),
				'20990102A-boom.js': throws,
			});

			expect((error as Error).message).toBe('migration failed');
			expect(flushCaches).toHaveBeenCalled();
		});

		it('does not flush when the whole run rolled back', async () => {
			const { error } = await runFixtures({
				'20990101A-first.js': createsFirst,
				'20990102A-boom.js': throws,
			});

			expect((error as Error).message).toBe('migration failed');
			expect(flushCaches).not.toHaveBeenCalled();
		});

		it('reports the migration failure even when the flush fails', async () => {
			flushCaches.mockRejectedValue(new Error('redis is down'));

			const { error } = await runFixtures({
				'20990101A-first.js': scopedTo('own', createsFirst),
				'20990102A-boom.js': throws,
			});

			expect((error as Error).message).toBe('migration failed');
			expect(flushCaches).toHaveBeenCalled();
		});

		it('warns which migration broke the all-or-nothing chain', async () => {
			await runFixtures({
				'20990101A-first.js': createsFirst,
				'20990102A-second.js': scopedTo('own', createsSecond),
			});

			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining('transactionScope "own"'),
			);
		});

		it('does not warn when the run opened no segment to commit', async () => {
			await runFixtures({
				'20990101A-first.js': scopedTo('own', createsFirst),
			});

			expect(warn).not.toHaveBeenCalled();
		});

		it('leaves a client it does not wrap exactly as it was', async () => {
			// SQLite's alter-table rebuild cannot survive an outer transaction, and
			// MySQL-family DDL implicit-commits, so neither is wrapped at all.
			client = 'sqlite3';

			const { error, applied, tables } = await runFixtures({
				'20990101A-first.js': createsFirst,
				'20990102A-boom.js': throws,
			});

			expect((error as Error).message).toBe('migration failed');
			expect(applied).toEqual(['20990101A']);
			expect(tables.first).toBe(true);
		});

		it('commits the open segment before an escaping migration', async () => {
			const { error, applied, tables } = await runFixtures({
				'20990101A-first.js': createsFirst,
				'20990102A-second.js': scopedTo('own', createsSecond),
				'20990103A-boom.js': throws,
			});

			expect((error as Error).message).toBe('migration failed');
			expect(applied).toEqual(['20990101A', '20990102A']);
			expect(tables.first).toBe(true);
			expect(tables.second).toBe(true);
		});
	});

	describe('the migration set this build ships', () => {
		let directory: string;

		afterEach(async () => {
			await rm(directory, { recursive: true, force: true });
		});

		// Applies every core migration to an empty database through the real runner.
		// Nothing smaller catches a migration that only misbehaves under whatever the
		// runner wraps around it: `20240204A-marketplace` opens a transaction of its
		// own, which an outer one turns into a savepoint that SQLite's alter-table
		// rebuild then invalidates, and the run dies on the migration after it.
		it('applies to a fresh sqlite database', async () => {
			directory = await mkdtemp(join(tmpdir(), 'directus-migration-set-'));

			const database = knex.default({
				client: 'sqlite3',
				connection: { filename: join(directory, 'probe.sqlite') },
				useNullAsDefault: true,
				pool: { min: 1, max: 1 },
			});

			const { default: installDatabase } = await import('../seeds/run.js');
			await installDatabase(database);

			const error = await run(database, 'latest', false).catch((e: Error) => e);

			await database.destroy();

			expect(error).toBeUndefined();
		}, 120_000);
	});
});
