import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import blackboxConfig from '../../../../vitest.config';

const fixturesDir = dirname(fileURLToPath(import.meta.url));
const blackboxDir = resolve(fixturesDir, '../../../..');

// The suite's own setup files and reporters, so the shard below reports its
// completions through whatever the suite wires them through.
const setupFiles = [blackboxConfig.test?.setupFiles ?? []].flat();
const reporters = [blackboxConfig.test?.reporters ?? []].flat() as string[];

export default defineConfig({
	test: {
		root: fixturesDir,
		include: ['*.fixture.ts'],
		setupFiles: setupFiles.map((file) => resolve(blackboxDir, file)),
		reporters: reporters.map((reporter) => {
			return reporter === 'default'
				? reporter
				: resolve(blackboxDir, reporter);
		}),
		provide: {
			projectName: 'common',
		},
	},
});
