import { defineConfig } from 'vitest/config';
import { VITEST_MAX_WORKERS } from '../vitest.max-workers';

export default defineConfig({
	test: {
		maxWorkers: VITEST_MAX_WORKERS,
		// The `*.test-d.ts` files here assert the public types. Without this they
		// are collected by nothing and silently never run.
		typecheck: {
			enabled: true,
		},
	},
});
