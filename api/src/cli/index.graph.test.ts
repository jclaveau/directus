import { expect, it, vi } from 'vitest';

/**
 * Which modules building the program reaches, by argv.
 *
 * `index.test.ts` imports the mocked modules itself, so their factories have run
 * before any of its tests. Here each factory is the proof: vitest runs one the
 * first time the module is imported, and a flag it leaves says the process
 * would have evaluated the real module — the extension manager's graph, the
 * database's, the API's — before it knew which command was asked for.
 */
const reached = vi.hoisted(() => new Set<string>());

vi.mock('directus/version', () => ({ version: '0.0.0' }));

vi.mock('./load-extensions.js', () => {
	reached.add('load-extensions');

	return { loadExtensions: vi.fn() };
});

vi.mock('../emitter.js', () => {
	reached.add('emitter');

	return { useEmitter: () => ({ emitInit: vi.fn() }) };
});

vi.mock('../server.js', () => {
	reached.add('server');

	return { startServer: vi.fn() };
});

vi.mock('../processes/autoscale/index.js', () => {
	reached.add('autoscale');

	return { runAutoscaler: vi.fn() };
});

it('reaches no module beyond commander for a built-in command', async () => {
	const { createCli } = await import('./index.js');

	await createCli(['autoscale']);
	await createCli(['start']);
	await createCli(['--some-option', 'schema', 'apply', 'snapshot.yaml']);

	expect([...reached]).toEqual([]);
});

it('reaches the extension loader and the emitter for anything else', async () => {
	const { createCli } = await import('./index.js');

	await createCli(['whatever-an-extension-registered']);

	expect([...reached].sort()).toEqual(['emitter', 'load-extensions']);
});
