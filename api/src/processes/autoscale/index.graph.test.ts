import { expect, it, vi } from 'vitest';

/**
 * Which modules the autoscaler's graph reaches.
 *
 * The factory is the proof: vitest runs it the first time any module in the
 * graph imports the one it mocks, and the flag it leaves says the process would
 * have evaluated it — the whole `@directus/utils` bundle (joi, date-fns, the
 * system-data tables) for a coercion `@directus/utils/values` carries alone;
 * the metrics registry, which is the database's graph, knex and prom-client,
 * for a counter this process cannot serve. The original is handed back so the
 * graph loads as it does in production and every importer in it is exercised.
 */
const reached = vi.hoisted(() => new Set<string>());

vi.mock('@directus/utils', async (importOriginal) => {
	reached.add('@directus/utils');

	return importOriginal();
});

vi.mock('../../metrics/index.js', async (importOriginal) => {
	reached.add('metrics');

	return importOriginal();
});

vi.mock('../../database/index.js', async (importOriginal) => {
	reached.add('database');

	return importOriginal();
});

// The graph is loaded for real — pm2, ioredis, the logger — which is seconds of
// module evaluation when the suite runs it beside other files.
const LOADS_THE_REAL_GRAPH_MS = 30_000;

it('reaches neither the utils bundle nor the database', async () => {
	await import('../../entry-guard.js');
	await import('./index.js');

	expect([...reached]).toEqual([]);
}, LOADS_THE_REAL_GRAPH_MS);
