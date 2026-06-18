import type { Knex } from 'knex';
import knex from 'knex';
import { createTracker, MockClient, Tracker } from 'knex-mock-client';
import type { MockedFunction } from 'vitest';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
});
