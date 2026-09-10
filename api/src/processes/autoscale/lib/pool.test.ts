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

test('a higher restart count than the last reading is a restart', async () => {
	const { restarted } = await import('./pool.js');

	expect(restarted(new Map([[0, 1]]), new Map([[0, 2]]))).toBe(true);
	expect(restarted(new Map([[0, 2]]), new Map([[0, 2]]))).toBe(false);
});

// A worker the previous reading never saw has nothing to compare against, and
// reading it as a restart would hold the loop off every time the pool grows.
test('a worker the previous reading never saw is not a restart', async () => {
	const { restarted } = await import('./pool.js');

	expect(restarted(new Map(), new Map([[1, 4]]))).toBe(false);
});

// A launching worker carries no usable numbers yet, and averaging the pool
// over its idle ones would ask for the workers that are already on their way.
test('a launching worker is counted as pending rather than online', async () => {
	const { readPool } = await import('./pool.js');

	listing([
		{
			name: 'directus',
			pm_id: 0,
			pid: 100,
			monit: { cpu: 0, memory: 0 },
			pm2_env: { status: 'launching' },
		},
	]);

	await expect(readPool('directus', 30)).resolves.toMatchObject({
		pendingWorkers: 1,
		onlineWorkers: [],
	});
});

test('a worker younger than the warmup is online and still warming', async () => {
	const { readPool } = await import('./pool.js');

	listing([
		{
			name: 'directus',
			pm_id: 0,
			pid: 100,
			monit: { cpu: 10, memory: 0 },
			pm2_env: { status: 'online', pm_uptime: Date.now() },
		},
	]);

	await expect(readPool('directus', 30)).resolves.toMatchObject({
		warmingWorkers: 1,
		onlineWorkers: [{ pid: 100, mature: false }],
	});
});
