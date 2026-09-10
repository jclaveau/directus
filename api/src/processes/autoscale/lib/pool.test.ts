import { beforeEach, expect, test, vi } from 'vitest';

const listSupervisedApps = vi.fn();

vi.mock('../../supervisor/index.js', () => {
	return { listSupervisedApps };
});

beforeEach(() => {
	listSupervisedApps.mockReset();
});

/** What the supervisor answers a list with. */
function listing(apps: unknown[]): void {
	listSupervisedApps.mockResolvedValue(apps);
}

test('a pool the supervisor lists no worker for reads as empty', async () => {
	const { readPool } = await import('./pool.js');

	listing([]);

	await expect(readPool('directus', 30)).resolves.toMatchObject({
		onlineWorkers: [],
		pendingWorkers: 0,
		supervisor: null,
	});
});

// What the pool is running under is asked of the supervisor rather than of this
// process's environment: the api worker serving the page that shows it was
// started by the same declaration, but a deployment scaling an app it does not
// itself belong to would report its own.
test('the declaration is read off the workers the supervisor listed', async () => {
	const { readPool } = await import('./pool.js');

	listing([
		{
			name: 'directus',
			pm_id: 0,
			pid: 100,
			monit: { cpu: 10, memory: 0 },
			pm2_env: {
				status: 'online',
				pm_uptime: 0,
				instances: 2,
				exec_mode: 'cluster_mode',
				kill_timeout: 30_000,
				wait_ready: true,
			},
		},
	]);

	await expect(readPool('directus', 30)).resolves.toMatchObject({
		supervisor: {
			instances: 2,
			execMode: 'cluster_mode',
			killTimeout: 30_000,
			waitReady: true,
		},
	});
});

// The supervisor lists every app it manages, and the autoscaler owns one of
// them: a worker of another app counted here would scale this pool on load it
// does not carry.
test('only the workers of the named app are read', async () => {
	const { readPool } = await import('./pool.js');

	listing([
		{
			name: 'directus',
			pm_id: 0,
			pid: 100,
			monit: { cpu: 10, memory: 0 },
			pm2_env: { status: 'online', pm_uptime: 0 },
		},
		{
			name: 'worker',
			pm_id: 1,
			pid: 101,
			monit: { cpu: 90, memory: 0 },
			pm2_env: { status: 'online', pm_uptime: 0 },
		},
	]);

	await expect(readPool('directus', 30)).resolves.toMatchObject({
		onlineWorkers: [{ pid: 100, cpuPercent: 10, mature: true }],
	});
});
