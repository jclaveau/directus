import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		globalSetup: ['./src/__setup__/global.js'],
		// Type tests are only worth writing if something runs them: `*.test-d.ts`
		// existed here for a year without ever executing. Enabling this also puts
		// `tsc` over everything they reach, which is the only type gate this
		// package has — the build strips types without checking them.
		typecheck: {
			enabled: true,
		},
	},
});
