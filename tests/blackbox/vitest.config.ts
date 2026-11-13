import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import Sequencer from './setup/sequencer';
import { MAX_WORKERS } from './setup/shard-files';

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		maxWorkers: MAX_WORKERS,
		// The timings land in `timings/` for CI to upload with each shard.
		reporters: [
			'default',
			'./setup/timings-reporter.ts',
			'./setup/completion-reporter.ts',
		],
		setupFiles: ['./setup/sequential-gate.ts'],
		sequence: {
			sequencer: Sequencer,
		},
		testTimeout: 30_000,
		projects: [
			{
				extends: true,
				test: {
					name: 'common',
					include: ['tests/common/**/*.test.ts', 'common/common.test.ts'],
					globalSetup: './setup/setup.ts',
					provide: {
						projectName: 'common',
					},
				},
			},
			{
				extends: true,
				test: {
					name: 'db',
					include: ['tests/db/**/*.test.ts', 'common/common.test.ts'],
					globalSetup: './setup/setup.ts',
					provide: {
						projectName: 'db',
					},
				},
			},
		],
	},
});
