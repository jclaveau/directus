import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		maxWorkers: 5,
		environment: 'happy-dom',
		globals: true,
	},
});
