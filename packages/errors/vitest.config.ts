import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		maxWorkers: 5,
		// The `*.test-d.ts` files here assert the public types. Without this they
		// are collected by nothing and silently never run.
		typecheck: {
			enabled: true,
		},
	},
});
