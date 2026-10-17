import { availableParallelism } from 'node:os';

// vitest's own default, capped at 5: a 4-vCPU CI runner keeps its 3 workers.
export const VITEST_MAX_WORKERS = Math.min(
	5,
	Math.max(availableParallelism() - 1, 1),
);
