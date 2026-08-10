import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const pm2 = vi.hoisted(() => {
	return { list: vi.fn() };
});

vi.mock('pm2', () => {
	return { default: { list: pm2.list } };
});

const logger = vi.hoisted(() => {
	return { warn: vi.fn() };
});

vi.mock('../../logger/index.js', () => {
	return { useLogger: () => logger };
});

import {
	readSupervisedProcesses,
	supervisorAvailable,
} from './supervisor-snapshot.js';

const platform = { ...process.env };

beforeEach(() => {
	process.env['PM2_HOME'] = '/tmp/pm2';
	pm2.list.mockReset();
	logger.warn.mockReset();
});

afterEach(() => {
	process.env = { ...platform };
});

/** `pm2.list` is callback-style; promisify turns (err, apps) into a promise. */
function listing(apps: unknown[]) {
	pm2.list.mockImplementation(
		(callback: (error: unknown, apps: unknown) => void) => {
			callback(null, apps);
		},
	);
}

test('PM2_HOME is how a supervised process knows it is supervised', () => {
	expect(supervisorAvailable()).toBe(true);

	delete process.env['PM2_HOME'];
	expect(supervisorAvailable()).toBe(false);
});

test('There is no list to read where there is no supervisor', async () => {
	delete process.env['PM2_HOME'];

	await expect(readSupervisedProcesses()).resolves.toBeNull();
	expect(pm2.list).not.toHaveBeenCalled();
});

test('Reads the cap, the mode and the restarts the page shows', async () => {
	listing([
		{
			name: 'directus',
			pid: 4242,
			pm_id: 0,
			monit: { memory: 482_000_000, cpu: 3 },
			pm2_env: {
				status: 'online',
				restart_time: 19,
				unstable_restarts: 2,
				pm_uptime: 1_700_000_000_000,
				max_memory_restart: 524_288_000,
				exec_mode: 'cluster_mode',
				instances: 3,
				NODE_APP_INSTANCE: 0,
			},
		},
	]);

	await expect(readSupervisedProcesses()).resolves.toEqual([
		{
			pid: 4242,
			pmId: 0,
			name: 'directus',
			instance: 0,
			stats: {
				status: 'online',
				restarts: 19,
				unstableRestarts: 2,
				uptimeMs: 1_700_000_000_000,
				memoryBytes: 482_000_000,
				cpuPercent: 3,
				maxMemoryRestartBytes: 524_288_000,
				execMode: 'cluster_mode',
				configuredInstances: 3,
			},
		},
	]);
});

test('The instance number survives being handed over as text', async () => {
	listing([{ pm2_env: { NODE_APP_INSTANCE: '2' } }]);

	const [process] = (await readSupervisedProcesses())!;

	expect(process!.instance).toBe(2);
});

test.each([
	['absent', undefined],
	['not a number', 'primary'],
])('An instance number that is %s reads as none', async (_case, value) => {
	listing([{ pm2_env: { NODE_APP_INSTANCE: value } }]);

	const [process] = (await readSupervisedProcesses())!;

	expect(process!.instance).toBeNull();
});

test('A row the daemon barely describes still becomes a process', async () => {
	listing([{}]);

	await expect(readSupervisedProcesses()).resolves.toEqual([
		{
			pid: null,
			pmId: null,
			name: 'unknown',
			instance: null,
			stats: {
				status: 'unknown',
				restarts: 0,
				unstableRestarts: 0,
				uptimeMs: null,
				memoryBytes: null,
				cpuPercent: null,
				maxMemoryRestartBytes: null,
				execMode: null,
				configuredInstances: null,
			},
		},
	]);
});

test('A daemon that cannot be reached reports nothing at all', async () => {
	pm2.list.mockImplementation((callback: (error: unknown) => void) => {
		callback(new Error('connect ENOENT'));
	});

	await expect(readSupervisedProcesses()).resolves.toBeNull();
	expect(logger.warn).toHaveBeenCalledOnce();
});
