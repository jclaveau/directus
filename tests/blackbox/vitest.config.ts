import tsconfigPaths from 'vite-tsconfig-paths';
import { defineConfig } from 'vitest/config';
import Sequencer from './setup/sequencer';

export default defineConfig({
	plugins: [tsconfigPaths()],
	test: {
		maxWorkers: 6,
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
