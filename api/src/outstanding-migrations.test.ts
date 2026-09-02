import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const outstandingMigrations = vi.fn();
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
const env: Record<string, string> = {};

vi.mock('./database/index.js', () => {
	return { outstandingMigrations: () => outstandingMigrations() };
});

vi.mock('./logger/index.js', () => {
	return { useLogger: () => logger };
});

vi.mock('@directus/env', () => {
	return { useEnv: () => env };
});

async function loadWatch() {
	vi.resetModules();
	return await import('./outstanding-migrations.js');
}

describe('outstanding migrations', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		env['MIGRATIONS_WAIT_TIMEOUT'] = '5m';
		env['MIGRATIONS_WAIT_INTERVAL'] = '2s';
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.clearAllMocks();
	});

	it('holds nothing when the watch was never started', async () => {
		const { outstandingMigrationsHoldingHealth } = await loadWatch();

		expect(outstandingMigrationsHoldingHealth()).toEqual([]);
		expect(outstandingMigrations).not.toHaveBeenCalled();
	});

	it('holds health before the first reading comes back', async () => {
		outstandingMigrations.mockReturnValue(new Promise(() => {}));

		const module = await loadWatch();
		module.watchOutstandingMigrations();

		expect(module.outstandingMigrationsHoldingHealth()).toBeUndefined();
	});

	it('releases health once the database has recorded every migration', async () => {
		outstandingMigrations.mockResolvedValue([]);

		const module = await loadWatch();
		module.watchOutstandingMigrations();
		await vi.advanceTimersByTimeAsync(0);

		expect(module.outstandingMigrationsHoldingHealth()).toEqual([]);
		expect(logger.info).toHaveBeenCalledWith('Database migrations are up to date');
	});

	it('keeps holding health while a migration is outstanding', async () => {
		outstandingMigrations.mockResolvedValue(['20990101A']);

		const module = await loadWatch();
		module.watchOutstandingMigrations();
		await vi.advanceTimersByTimeAsync(0);

		expect(module.outstandingMigrationsHoldingHealth()).toEqual(['20990101A']);
	});

	it('releases health on a later poll once the migration lands', async () => {
		outstandingMigrations
			.mockResolvedValueOnce(['20990101A'])
			.mockResolvedValueOnce([]);

		const module = await loadWatch();
		module.watchOutstandingMigrations();
		await vi.advanceTimersByTimeAsync(0);

		expect(module.outstandingMigrationsHoldingHealth()).toEqual(['20990101A']);

		await vi.advanceTimersByTimeAsync(3000);

		expect(module.outstandingMigrationsHoldingHealth()).toEqual([]);
		expect(outstandingMigrations).toHaveBeenCalledTimes(2);
	});

	it('rides out a database error and keeps health down meanwhile', async () => {
		outstandingMigrations
			.mockRejectedValueOnce(new Error('pool exhausted'))
			.mockResolvedValueOnce([]);

		const module = await loadWatch();
		module.watchOutstandingMigrations();
		await vi.advanceTimersByTimeAsync(0);

		expect(module.outstandingMigrationsHoldingHealth()).toBeUndefined();
		expect(logger.warn).toHaveBeenCalled();

		await vi.advanceTimersByTimeAsync(3000);

		expect(module.outstandingMigrationsHoldingHealth()).toEqual([]);
	});

	it('stops polling at the timeout and leaves health held', async () => {
		env['MIGRATIONS_WAIT_TIMEOUT'] = '4s';
		outstandingMigrations.mockResolvedValue(['20990101A']);

		const module = await loadWatch();
		module.watchOutstandingMigrations();
		await vi.advanceTimersByTimeAsync(20000);

		const polls = outstandingMigrations.mock.calls.length;

		expect(module.outstandingMigrationsHoldingHealth()).toEqual(['20990101A']);

		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining('20990101A'),
		);

		await vi.advanceTimersByTimeAsync(20000);

		expect(outstandingMigrations).toHaveBeenCalledTimes(polls);
	});

	it('names an unreadable database in the give-up message', async () => {
		env['MIGRATIONS_WAIT_TIMEOUT'] = '0s';
		outstandingMigrations.mockRejectedValue(new Error('pool exhausted'));

		const module = await loadWatch();
		module.watchOutstandingMigrations();
		await vi.advanceTimersByTimeAsync(0);

		expect(logger.error).toHaveBeenCalledWith(
			expect.stringContaining('the database could not be read'),
		);
	});

	it('holds health without touching the database', async () => {
		const module = await loadWatch();
		module.holdHealthForOutstandingMigrations();

		expect(module.outstandingMigrationsHoldingHealth()).toBeUndefined();
		expect(outstandingMigrations).not.toHaveBeenCalled();
	});

	it('names the budget it actually used when giving up', async () => {
		env['MIGRATIONS_WAIT_TIMEOUT'] = '';
		outstandingMigrations.mockResolvedValue(['20990101A']);

		const module = await loadWatch();
		module.watchOutstandingMigrations();
		await vi.advanceTimersByTimeAsync(400000);

		expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('300000ms'));
	});

	it('ignores a second start rather than running two loops', async () => {
		outstandingMigrations.mockResolvedValue(['20990101A']);

		const module = await loadWatch();
		module.watchOutstandingMigrations();
		module.watchOutstandingMigrations();
		await vi.advanceTimersByTimeAsync(0);

		expect(outstandingMigrations).toHaveBeenCalledTimes(1);
	});

	it('stops polling once shutdown has been signalled', async () => {
		outstandingMigrations.mockResolvedValue(['20990101A']);

		const module = await loadWatch();
		module.watchOutstandingMigrations();
		await vi.advanceTimersByTimeAsync(0);

		module.stopWatchingOutstandingMigrations();
		await vi.advanceTimersByTimeAsync(20000);

		expect(outstandingMigrations).toHaveBeenCalledTimes(1);
	});
});
