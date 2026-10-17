import { defineConfig } from 'vitest/config';
import { VITEST_MAX_WORKERS } from '../../vitest.max-workers';

export default defineConfig({
	test: {
		maxWorkers: VITEST_MAX_WORKERS,
		environment: 'happy-dom',
		globals: true,
	},
});
