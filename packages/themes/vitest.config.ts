import { defineConfig, mergeConfig } from 'vitest/config';
import { VITEST_MAX_WORKERS } from '../../vitest.max-workers.ts';
import viteConfig from './vite.config.ts';

export default mergeConfig(viteConfig, defineConfig({
	test: {
		maxWorkers: VITEST_MAX_WORKERS,
	},
}));
