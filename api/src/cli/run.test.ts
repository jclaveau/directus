import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createCli } from './index.js';
import { armDeadline } from './utils/arm-deadline.js';

// Factories, not automocks: an automock imports the real module to shape itself,
// and `createCli` pulls the whole API graph in behind it.
vi.mock('./index.js', () => ({ createCli: vi.fn() }));
vi.mock('./utils/arm-deadline.js', () => ({ armDeadline: vi.fn() }));
vi.mock('@directus/env', () => ({ useEnv: () => ({ CACHE_FLUSH_TIMEOUT: '9s' }) }));

const argv = process.argv;

beforeEach(() => {
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

test('leaves every other command unbudgeted', async () => {
	process.argv = ['node', 'directus', 'database', 'migrate:latest'];

	await import('./run.js');

	expect(armDeadline).not.toHaveBeenCalled();
});
