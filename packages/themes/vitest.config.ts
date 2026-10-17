import { defineConfig, mergeConfig } from 'vitest/config';
import { VITEST_MAX_WORKERS } from '../../vitest.max-workers';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
	test: {
		maxWorkers: VITEST_MAX_WORKERS,
	},
}));
