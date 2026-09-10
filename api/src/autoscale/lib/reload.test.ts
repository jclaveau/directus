import type { AutoscaleRunner, AutoscaleSupervisor } from '@directus/types';
import { afterEach, beforeAll, beforeEach, expect, test, vi } from 'vitest';

vi.mock('../../logger/index.js', () => {
	return {
		useLogger: () => {
			return { warn: vi.fn(), info: vi.fn(), error: vi.fn() };
		},
	};
});

const publish = vi.fn();
const subscribe = vi.fn();

vi.mock('../../bus/index.js', () => {
	return {
		useBus: () => {
			return { publish, subscribe };
		},
	};
});

const reloadApp = vi.fn();

vi.mock('../../processes/supervisor/index.js', () => {
	return { reloadApp };
});

const readSupervisorSharedConfig = vi.fn(async () => null);
const reloadDeclaration = vi.fn(() => DECLARATION);

vi.mock('./supervisor-shared-config.js', () => {
	return { readSupervisorSharedConfig, reloadDeclaration };
});

/** What the options an operator changed come to, as pm2 names them. */
const DECLARATION = { listen_timeout: 15_000, kill_timeout: 30_000 };

// Compiling the graph behind these modules is seconds of work, and a case that
// pays it is a case timing its own toolchain.
beforeAll(async () => {
	await import('./reload.js');
});

/**
 * A fresh copy of the module per case: where the last restart got to is module
 * state, which is the whole point — it is what the loop reads to hold still
 * and what the page reads to say a restart is happening.
 */
async function freshModule() {
	vi.resetModules();

	return import('./reload.js');
}

/** The handler the loop registered, called as the bus would call it. */
function ask(at = Date.now()): void {
	subscribe.mock.calls.at(-1)?.[1]({ at });
}

function supervisor(
	overrides: Partial<AutoscaleSupervisor> = {},
): AutoscaleSupervisor {
	return {
		instances: 2,
		execMode: 'cluster_mode',
		maxMemoryRestart: null,
		listenTimeout: 15_000,
		killTimeout: 30_000,
		minUptime: 1000,
		maxRestarts: 16,
		restartDelay: 0,
		autorestart: true,
		waitReady: true,
		...overrides,
	};
}

function runner(
	state: Partial<AutoscaleRunner['state']> = {},
): AutoscaleRunner {
	return {
		service: 'api',
		replicaId: 'one',
		nodeId: 'node',
		name: 'api',
		state: {
			supervisor: supervisor(),
			reload: { askedAt: null, running: false, finishedAt: null, error: null },
			...state,
		} as AutoscaleRunner['state'],
	};
}

beforeEach(() => {
	publish.mockClear();
	subscribe.mockClear();
	reloadApp.mockReset();
	reloadApp.mockResolvedValue(undefined);
	readSupervisorSharedConfig.mockClear();
	reloadDeclaration.mockClear();
});

afterEach(() => {
	vi.restoreAllMocks();
});

test('asking publishes the request and reports nothing started yet', async () => {
	const { askForReload } = await freshModule();

	const before = Date.now();
	const asked = askForReload();

	expect(asked.askedAt).toBeGreaterThanOrEqual(before);
	expect(asked.running).toBe(false);
	expect(publish).toHaveBeenCalledWith('autoscaleReload', { at: asked.askedAt });
});

// The loop reads this to hold still, so a request has to count from the moment
// it lands rather than from the tick that acts on it: a decision taken in
// between is one taken on a pool about to be replaced.
test('a request holds the loop still before anything has started', async () => {
	const { initAutoscaleReload, reloading, reloadState } = await freshModule();

	initAutoscaleReload();
	expect(reloading()).toBe(false);

	ask(1000);

	expect(reloading()).toBe(true);
	expect(reloadState().askedAt).toBe(1000);
	expect(reloadApp).not.toHaveBeenCalled();
});

test('a second request while one is under way is dropped', async () => {
	const { initAutoscaleReload, reloadState } = await freshModule();

	initAutoscaleReload();
	ask(1000);
	ask(2000);

	expect(reloadState().askedAt).toBe(1000);
});

test('the restart runs beside the loop and reports that it finished', async () => {
	const { beginAskedReload, initAutoscaleReload, reloading, reloadState }
		= await freshModule();

	initAutoscaleReload();
	ask();

	readSupervisorSharedConfig
		.mockResolvedValueOnce({ listenTimeout: 20_000 } as never);

	beginAskedReload('directus', 4);

	// Held still from the moment it starts, not from the moment the supervisor
	// is reached: the shared config it carries is a read away.
	expect(reloading()).toBe(true);

	await vi.waitFor(() => {
		expect(reloadApp)
			.toHaveBeenCalledWith('directus', 4 * 45_000 + 30_000, DECLARATION);
	});

	// The options an operator stored are what the restart pushes, so the
	// declaration is built from the read rather than from the environment.
	expect(reloadDeclaration).toHaveBeenCalledWith({ listenTimeout: 20_000 });

	await vi.waitFor(() => {
		expect(reloading()).toBe(false);
	});

	expect(reloadState().finishedAt).not.toBeNull();
	expect(reloadState().error).toBeNull();
});

// A restart the supervisor refused has to stop holding the loop still, or a
// pool that cannot restart is also a pool that cannot scale.
test('a restart that failed reports why and releases the loop', async () => {
	const { beginAskedReload, initAutoscaleReload, reloading, reloadState }
		= await freshModule();

	reloadApp.mockRejectedValue(new Error('Reload in progress'));

	initAutoscaleReload();
	ask();
	beginAskedReload('directus', 4);

	await vi.waitFor(() => {
		expect(reloading()).toBe(false);
	});

	expect(reloadState().error).toBe('Reload in progress');
});

test('a tick with nothing asked for starts nothing', async () => {
	const { beginAskedReload, initAutoscaleReload } = await freshModule();

	initAutoscaleReload();
	beginAskedReload('directus', 4);

	expect(reloadApp).not.toHaveBeenCalled();
});

// Each worker costs the time it has to come up plus the time the one it
// replaces has to go, and the supervisor is only ever asked for a pool it
// could take minutes over.
test('the budget covers every worker under its own declaration', async () => {
	const { reloadBudgetMs } = await freshModule();

	expect(reloadBudgetMs(8, DECLARATION)).toBe(8 * 45_000 + 30_000);
});

test('a declaration that names no timeout gets pm2 own fallbacks', async () => {
	const { reloadBudgetMs } = await freshModule();

	expect(reloadBudgetMs(2, {})).toBe(2 * 4600 + 30_000);
});

test('an empty pool still gets one worker worth of budget', async () => {
	const { reloadBudgetMs } = await freshModule();

	expect(reloadBudgetMs(0, DECLARATION)).toBe(45_000 + 30_000);
});

test('a pool nothing reported is refused', async () => {
	const { reloadRefusal } = await freshModule();

	expect(reloadRefusal([])).toMatch(/nothing would hear this/);
});

test('a pool already restarting is refused', async () => {
	const { reloadRefusal } = await freshModule();

	const running = runner({
		reload: { askedAt: 1, running: true, finishedAt: null, error: null },
	});

	expect(reloadRefusal([running])).toMatch(/already being restarted/);
});

// Outside a cluster the supervisor stops a worker before starting its
// replacement, which is the downtime the whole thing exists to avoid.
test('a pool that cannot overlap its workers is refused', async () => {
	const { reloadRefusal } = await freshModule();

	const forked = runner({ supervisor: supervisor({ execMode: 'fork_mode' }) });

	expect(reloadRefusal([forked])).toMatch(/fork_mode/);
});

test('a pool with no worker to restart is refused', async () => {
	const { reloadRefusal } = await freshModule();

	expect(reloadRefusal([runner({ supervisor: null })]))
		.toMatch(/no worker of this pool/);
});

test('a cluster at rest is not refused', async () => {
	const { reloadRefusal } = await freshModule();

	expect(reloadRefusal([runner()])).toBeNull();
});
