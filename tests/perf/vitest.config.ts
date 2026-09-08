import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		include: ['**/*.perf.test.ts'],
		// Every measurement spawns real servers, so nothing here may share a machine
		// with anything else that runs.
		fileParallelism: false,
		pool: 'forks',
		poolOptions: { forks: { singleFork: true } },
		testTimeout: 10 * 60 * 1000,
		hookTimeout: 10 * 60 * 1000,
	},
});
