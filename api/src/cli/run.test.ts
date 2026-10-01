import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createCli } from './index.js';
import { armDeadline } from './utils/arm-deadline.js';

// Factories, not automocks: an automock imports the real module to shape itself,
// and `createCli` pulls the whole API graph in behind it.
vi.mock('./index.js', () => ({ createCli: vi.fn() }));
vi.mock('./utils/arm-deadline.js', () => ({ armDeadline: vi.fn() }));
const env = vi.hoisted(() => ({}) as Record<string, unknown>);
vi.mock('@directus/env', () => ({ useEnv: () => env }));

// The guard is imported for its side effect, and the module behind it reaches
// the logger and the metrics registry — graphs this file otherwise never loads,
// and 3.6s of the 5s budget when it does. What it guards is pinned end to end by
// `cli-boot-redis-outage.test.ts`, which boots the real CLI at a dead Redis.
vi.mock('../entry-guard.js', () => ({}));

const argv = process.argv;

beforeEach(() => {
	for (const key of Object.keys(env)) {
		delete env[key];
	}

	env['CACHE_FLUSH_TIMEOUT'] = '9s';
	env['CACHE_AUTO_FLUSH_ON_DEPLOY'] = true;
	env['PRESSURE_LIMITER_ENABLED'] = true;
	vi.mocked(createCli).mockReturnValue(new Promise(() => {}));
});

afterEach(() => {
	process.argv = argv;
	vi.resetModules();
	vi.clearAllMocks();
});

// The CLI's own bootstrap reads through the same Redis the flush does, so a flush
// aimed at one that is down never reaches the command it was asked to run. Arming
// the deadline inside the action would leave that hang uncovered, which is the
// shape this pins: armed before `createCli` is even awaited.
test('arms the flush deadline before the CLI boots', async () => {
	process.argv = ['node', 'directus', 'cache', 'flush'];

	await import('./run.js');

	expect(armDeadline).toHaveBeenCalledWith(9000, 'the cache flush');
});

// Commander reads the program's own options ahead of the subcommand, so the
// command name is not reliably the first argument.
test('finds the command past a global option', async () => {
	process.argv = ['node', 'directus', '--experimental', 'cache', 'flush'];

	await import('./run.js');

	expect(armDeadline).toHaveBeenCalledWith(9000, 'the cache flush');
});

test('leaves every other command unbudgeted', async () => {
	process.argv = ['node', 'directus', 'database', 'migrate:latest'];

	await import('./run.js');

	expect(armDeadline).not.toHaveBeenCalled();
});

// The audit boots the app the way `start` does, and that boot flushes the cache
// when the build identity moved — from a shell that is not the service, it
// always has. The audit would then inspect the empty cache it just made. Its
// replays go through the event loop that just booted, which the pressure
// limiter samples as saturated: they would come back 503 with nobody to protect.
test('keeps the audit boot from flushing and throttling the cache', async () => {
	process.argv = ['node', 'directus', 'cache', 'audit', '--json'];

	await import('./run.js');

	expect(env['CACHE_AUTO_FLUSH_ON_DEPLOY']).toBe(false);
	expect(env['PRESSURE_LIMITER_ENABLED']).toBe(false);
	expect(armDeadline).not.toHaveBeenCalled();
});

test('leaves the flush and the limiter armed for every other command', async () => {
	process.argv = ['node', 'directus', 'cache', 'flush'];

	await import('./run.js');

	expect(env['CACHE_AUTO_FLUSH_ON_DEPLOY']).toBe(true);
	expect(env['PRESSURE_LIMITER_ENABLED']).toBe(true);
});
