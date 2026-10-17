import { defineConfig } from 'vitest/config';
import { VITEST_MAX_WORKERS } from '../vitest.max-workers.ts';

export default defineConfig({
	test: {
		maxWorkers: VITEST_MAX_WORKERS,
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
