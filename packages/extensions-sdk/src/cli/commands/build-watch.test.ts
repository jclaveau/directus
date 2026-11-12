import fse from 'fs-extra';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import build from './build.js';

// A watch never returns on its own, so rolldown's watcher is stubbed: what is
// pinned here is which entrypoints a watched build hands it.

const watchMocks = vi.hoisted(() => {
	return {
		rolldownWatch: vi.fn(() => ({ on: () => undefined })),
	};
});

vi.mock('rolldown', async (importOriginal) => {
	return {
		...(await importOriginal<typeof import('rolldown')>()),
		watch: watchMocks.rolldownWatch,
	};
});

const origCwd = process.cwd();
let extensionRoot = '';

beforeEach(async () => {
	extensionRoot = await mkdtemp(resolve(tmpdir(), 'build-watch-'));
});

afterEach(async () => {
	process.chdir(origCwd);
	vi.resetAllMocks();
	vi.restoreAllMocks();
	await rm(extensionRoot, { recursive: true, force: true });
});

test('watches both sides of a hybrid extension', async () => {
	await fse.outputFile(
		resolve(extensionRoot, 'src', 'app.js'),
		'export default {};\n',
	);

	await fse.outputFile(
		resolve(extensionRoot, 'src', 'api.js'),
		'export default {};\n',
	);

	process.chdir(extensionRoot);

	await build({
		type: 'operation',
		input: JSON.stringify({ app: 'src/app.js', api: 'src/api.js' }),
		output: JSON.stringify({ app: 'dist/app.js', api: 'dist/api.js' }),
		watch: true,
	});

	expect(watchMocks.rolldownWatch).toHaveBeenCalledTimes(2);

	expect(watchMocks.rolldownWatch).toHaveBeenNthCalledWith(
		1,
		expect.objectContaining({ input: 'src/app.js', platform: 'browser' }),
	);

	expect(watchMocks.rolldownWatch).toHaveBeenNthCalledWith(
		2,
		expect.objectContaining({ input: 'src/api.js', platform: 'node' }),
	);
});

test('watches the api side alone of an api-only code bundle', async () => {
	await fse.outputFile(
		resolve(extensionRoot, 'src', 'api.ts'),
		'export default {};\n',
	);

	await fse.outputJson(resolve(extensionRoot, 'package.json'), {
		name: 'an-api-only-bundle',
		version: '0.0.0',
		type: 'module',
		'directus:extension': {
			type: 'bundle',
			host: '^11.0.0',
			path: { app: 'dist/app.js', api: 'dist/api.js' },
		},
	});

	process.chdir(extensionRoot);

	await build({ watch: true });

	expect(watchMocks.rolldownWatch).toHaveBeenCalledTimes(1);

	expect(watchMocks.rolldownWatch).toHaveBeenCalledWith(
		expect.objectContaining({ input: 'src/api.ts', platform: 'node' }),
	);
});
