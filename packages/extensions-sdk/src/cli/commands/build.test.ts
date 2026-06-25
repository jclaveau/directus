import fse from 'fs-extra';
import { resolve } from 'node:path';
import { afterAll, afterEach, describe, expect, test } from 'vitest';
import { create } from '../index.js';
import build from './build.js';

// directus-extension.test.ts already builds extensions end-to-end, but it shells out
// (`execa node ../cli.js build`), so build.ts runs in a child process and is invisible
// to coverage. These call build() in-process — same rolldown paths, but instrumented —
// to pin the rollup→rolldown migration (app/api/hybrid each exercise getRollupOptions'
// platform branch + the buildExtension/buildHybridExtension dispatch).

const TEST_PREFIX = 'temp-build-inproc';
const origCwd = process.cwd();

afterEach(() => {
	process.chdir(origCwd);
});

afterAll(async () => {
	const artifacts = (await fse.readdir(origCwd)).filter((file) => file.startsWith(TEST_PREFIX));

	for (const artifact of artifacts) {
		await fse.remove(resolve(origCwd, artifact));
	}
});

describe('build', () => {
	test.each([
		{ type: 'interface', dist: ['index.js'] }, // app extension → browser platform
		{ type: 'endpoint', dist: ['index.js'] }, // api extension → node platform
		{ type: 'operation', dist: ['app.js', 'api.js'] }, // hybrid extension → both
	])(
		'builds a $type extension to dist',
		async ({ type, dist }) => {
			const extensionPath = `${TEST_PREFIX}-${type}-${Date.now()}`;

			await create(type, extensionPath, { language: 'typescript' });

			process.chdir(resolve(origCwd, extensionPath));

			try {
				await build({});
			} finally {
				process.chdir(origCwd);
			}

			for (const file of dist) {
				expect(fse.pathExistsSync(resolve(origCwd, extensionPath, 'dist', file))).toBe(true);
			}
		},
		30_000,
	);
});
