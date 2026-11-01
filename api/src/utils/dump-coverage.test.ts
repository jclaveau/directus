import {
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	COVERAGE_DUMP_NAME,
	dumpCoverage,
	readExtensionCoverageDirs,
	splitCoverage,
} from './dump-coverage.js';

const { logger } = vi.hoisted(() => {
	return { logger: { warn: vi.fn() } };
});

vi.mock('../logger/index.js', () => ({ useLogger: () => logger }));

let workDir: string;

beforeEach(async () => {
	// Real path: on macOS the tmpdir is a symlink, and coverage keys are real paths.
	workDir = await realpath(await mkdtemp(join(tmpdir(), 'dump-coverage-')));
});

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	delete (globalThis as Record<string, unknown>)['__coverage__'];
	delete (globalThis as Record<string, unknown>)['__extensionCoverageDirs'];

	await rm(workDir, { recursive: true, force: true });
});

describe('splitCoverage', () => {
	test('sends an extension the files it bundled and core the rest', () => {
		const split = splitCoverage(
			{
				'/repo/ext-a/src/a.ts': 'a',
				'/repo/shared/date.ts': 'shared',
				'/repo/ext-a/scripts/seed.ts': 'seed',
				'src/controllers/server.ts': 'core',
			},
			[
				{
					sourceRoot: '/repo/ext-a',
					coverageDir: '/repo/ext-a/coverage',
					sourceFiles: ['/repo/ext-a/src/a.ts', '/repo/shared/date.ts'],
				},
			],
			'/cov/core',
		);

		expect(split).toEqual({
			coverageByDir: new Map([
				[
					'/repo/ext-a/coverage',
					{ '/repo/ext-a/src/a.ts': 'a', '/repo/shared/date.ts': 'shared' },
				],
				[
					'/cov/core',
					{
						'/repo/ext-a/scripts/seed.ts': 'seed',
						'src/controllers/server.ts': 'core',
					},
				],
			]),
			unownedCount: 0,
		});
	});

	test('sends a file two extensions bundled to both', () => {
		const split = splitCoverage(
			{ '/repo/shared/date.ts': 'shared' },
			[
				{
					sourceRoot: '/repo/ext-a',
					coverageDir: '/repo/ext-a/coverage',
					sourceFiles: ['/repo/shared/date.ts'],
				},
				{
					sourceRoot: '/repo/ext-b',
					coverageDir: '/repo/ext-b/coverage',
					sourceFiles: ['/repo/shared/date.ts'],
				},
			],
			undefined,
		);

		expect(split).toEqual({
			coverageByDir: new Map([
				['/repo/ext-a/coverage', { '/repo/shared/date.ts': 'shared' }],
				['/repo/ext-b/coverage', { '/repo/shared/date.ts': 'shared' }],
			]),
			unownedCount: 0,
		});
	});

	test('counts the files no extension owns when there is no core directory', () => {
		const split = splitCoverage(
			{ '/repo/ext-a/src/a.ts': 'a', '/repo/shared/y.ts': 'y' },
			[
				{
					sourceRoot: '/repo/ext-a',
					coverageDir: '/repo/ext-a/coverage',
					sourceFiles: ['/repo/ext-a/src/a.ts'],
				},
			],
			undefined,
		);

		expect(split).toEqual({
			coverageByDir: new Map([
				['/repo/ext-a/coverage', { '/repo/ext-a/src/a.ts': 'a' }],
			]),
			unownedCount: 1,
		});
	});

	test('writes one directory spelled two ways into one file', () => {
		const split = splitCoverage(
			{ '/repo/ext/src/a.ts': 'a', 'src/app.ts': 'core' },
			[
				{
					sourceRoot: '/repo/ext',
					coverageDir: '/repo/cov',
					sourceFiles: ['/repo/ext/src/a.ts'],
				},
			],
			'/repo/cov/',
		);

		expect(split).toEqual({
			coverageByDir: new Map([
				['/repo/cov', { '/repo/ext/src/a.ts': 'a', 'src/app.ts': 'core' }],
			]),
			unownedCount: 0,
		});
	});
});

describe('readExtensionCoverageDirs', () => {
	test('reads nothing when no instrumented extension is loaded', () => {
		expect(readExtensionCoverageDirs()).toEqual([]);
	});
});

describe('dumpCoverage', () => {
	test('writes nothing when nothing loaded is instrumented', async () => {
		vi.stubEnv('COVERAGE_DIR', join(workDir, 'core'));

		expect(await dumpCoverage()).toEqual([]);
		await expect(readdir(workDir)).resolves.toEqual([]);
	});

	test('writes each directory its own files, one file per process', async () => {
		vi.stubEnv('COVERAGE_DIR', join(workDir, 'core'));

		(globalThis as Record<string, unknown>)['__extensionCoverageDirs'] = [
			{
				sourceRoot: join(workDir, 'ext'),
				coverageDir: join(workDir, 'ext/cov'),
				sourceFiles: [join(workDir, 'ext/src/a.ts')],
			},
		];

		(globalThis as Record<string, unknown>)['__coverage__'] = {
			[join(workDir, 'ext/src/a.ts')]: { s: { 0: 1 } },
			'src/app.ts': { s: { 0: 1 } },
		};

		await dumpCoverage();

		(globalThis as Record<string, unknown>)['__coverage__'] = {
			[join(workDir, 'ext/src/a.ts')]: { s: { 0: 2 } },
			'src/app.ts': { s: { 0: 2 } },
		};

		expect(await dumpCoverage()).toEqual([
			{ dir: join(workDir, 'ext/cov'), fileCount: 1 },
			{ dir: join(workDir, 'core'), fileCount: 1 },
		]);

		// Overwritten, not added: the merge would sum two snapshots of one process.
		await expect(readdir(join(workDir, 'ext/cov')))
			.resolves.toEqual([COVERAGE_DUMP_NAME]);

		await expect(readdir(join(workDir, 'core')))
			.resolves.toEqual([COVERAGE_DUMP_NAME]);

		await expect(readFile(join(workDir, 'ext/cov', COVERAGE_DUMP_NAME), 'utf8'))
			.resolves.toBe(JSON.stringify({
				[join(workDir, 'ext/src/a.ts')]: { s: { 0: 2 } },
			}));

		await expect(readFile(join(workDir, 'core', COVERAGE_DUMP_NAME), 'utf8'))
			.resolves.toBe(JSON.stringify({ 'src/app.ts': { s: { 0: 2 } } }));
	});

	test('warns with the count of files it could not write anywhere', async () => {
		vi.stubEnv('COVERAGE_DIR', '');

		(globalThis as Record<string, unknown>)['__coverage__'] = {
			'src/app.ts': {},
			'src/server.ts': {},
		};

		expect(await dumpCoverage()).toEqual([]);

		expect(logger.warn).toHaveBeenCalledWith(
			'Coverage of 2 source files not written: no extension built with '
				+ 'coverage owns them, and COVERAGE_DIR is unset.',
		);
	});

	test('writes every other directory when one cannot be written', async () => {
		vi.stubEnv('COVERAGE_DIR', join(workDir, 'core'));
		await writeFile(join(workDir, 'blocked'), '');

		(globalThis as Record<string, unknown>)['__extensionCoverageDirs'] = [
			{
				sourceRoot: join(workDir, 'ext'),
				coverageDir: join(workDir, 'blocked/cov'),
				sourceFiles: [join(workDir, 'ext/src/a.ts')],
			},
		];

		(globalThis as Record<string, unknown>)['__coverage__'] = {
			[join(workDir, 'ext/src/a.ts')]: {},
			'src/app.ts': {},
		};

		await expect(dumpCoverage()).rejects.toThrow(new Error(
			`Coverage not written to ${join(workDir, 'blocked/cov')}: ENOTDIR: not `
				+ `a directory, mkdir '${join(workDir, 'blocked/cov')}'`,
		));

		await expect(readdir(join(workDir, 'core')))
			.resolves.toEqual([COVERAGE_DUMP_NAME]);
	});

	test('runs two dumps asked at once one after the other', async () => {
		vi.stubEnv('COVERAGE_DIR', join(workDir, 'core'));
		(globalThis as Record<string, unknown>)['__coverage__'] = { 'src/app.ts': {} };

		// Run together, both would rename the same `.partial` and one would fail.
		await expect(Promise.all([dumpCoverage(), dumpCoverage()])).resolves.toEqual([
			[{ dir: join(workDir, 'core'), fileCount: 1 }],
			[{ dir: join(workDir, 'core'), fileCount: 1 }],
		]);
	});

	test('runs the dump asked after a failed one', async () => {
		vi.stubEnv('COVERAGE_DIR', join(workDir, 'core'));
		await writeFile(join(workDir, 'core'), '');
		(globalThis as Record<string, unknown>)['__coverage__'] = { 'src/app.ts': {} };

		await expect(dumpCoverage()).rejects.toThrow(new Error(
			`Coverage not written to ${join(workDir, 'core')}: EEXIST: file already `
				+ `exists, mkdir '${join(workDir, 'core')}'`,
		));

		await rm(join(workDir, 'core'));

		await expect(dumpCoverage()).resolves.toEqual([
			{ dir: join(workDir, 'core'), fileCount: 1 },
		]);
	});

	test('writes the coverage a sandbox recorded where it registered', async () => {
		vi.resetModules();
		const reloadedModule = await import('./dump-coverage.js');

		expect(reloadedModule.isCoverageInstrumented()).toBe(false);

		reloadedModule.trackSandboxCoverage(async () => {
			return {
				coverage: { '/ext/src/a.ts': { hash: 'h1', s: { 0: 1 }, f: {}, b: {} } },
				coverageDirs: [{
					sourceRoot: '/ext',
					coverageDir: join(workDir, 'ext/cov'),
					sourceFiles: ['/ext/src/a.ts'],
				}],
			};
		});

		expect(reloadedModule.isCoverageInstrumented()).toBe(true);

		await expect(reloadedModule.dumpCoverage()).resolves.toEqual([
			{ dir: join(workDir, 'ext/cov'), fileCount: 1 },
		]);
	});

	test('leaves the directories the server registered as they were', async () => {
		vi.resetModules();
		const reloadedModule = await import('./dump-coverage.js');

		(globalThis as Record<string, unknown>)['__extensionCoverageDirs'] = [{
			sourceRoot: '/server-ext',
			coverageDir: join(workDir, 'server-ext/cov'),
			sourceFiles: ['/server-ext/src/a.ts'],
		}];

		reloadedModule.trackSandboxCoverage(async () => {
			return {
				coverage: { '/ext/src/a.ts': { hash: 'h1', s: { 0: 1 }, f: {}, b: {} } },
				coverageDirs: [{
					sourceRoot: '/ext',
					coverageDir: join(workDir, 'ext/cov'),
					sourceFiles: ['/ext/src/a.ts'],
				}],
			};
		});

		await reloadedModule.dumpCoverage();

		expect((globalThis as Record<string, unknown>)['__extensionCoverageDirs'])
			.toEqual([{
				sourceRoot: '/server-ext',
				coverageDir: join(workDir, 'server-ext/cov'),
				sourceFiles: ['/server-ext/src/a.ts'],
			}]);
	});

	test('reads a sandbox once when it is unloaded twice', async () => {
		vi.resetModules();
		const reloadedModule = await import('./dump-coverage.js');

		// a removed extension is unloaded again by every later reload
		const releaseSandboxCoverage = reloadedModule.trackSandboxCoverage(vi.fn()
			.mockResolvedValueOnce({
				coverage: { '/ext/src/a.ts': { hash: 'h1', s: { 0: 1 }, f: {}, b: {} } },
				coverageDirs: [{
					sourceRoot: '/ext',
					coverageDir: join(workDir, 'ext/cov'),
					sourceFiles: ['/ext/src/a.ts'],
				}],
			})
			.mockRejectedValue(new Error('Isolate is disposed')));

		await releaseSandboxCoverage();

		await expect(releaseSandboxCoverage()).resolves.toBeUndefined();

		await expect(reloadedModule.dumpCoverage()).resolves.toEqual([
			{ dir: join(workDir, 'ext/cov'), fileCount: 1 },
		]);
	});

	test('starts a file over when its code changed between two loads', async () => {
		vi.resetModules();
		const reloadedModule = await import('./dump-coverage.js');

		const coverageDirs = [{
			sourceRoot: '/ext',
			coverageDir: join(workDir, 'ext/cov'),
			sourceFiles: ['/ext/src/a.ts'],
		}];

		reloadedModule.trackSandboxCoverage(async () => {
			return {
				coverage: { '/ext/src/a.ts': { hash: 'h1', s: { 0: 5 }, f: {}, b: {} } },
				coverageDirs,
			};
		});

		reloadedModule.trackSandboxCoverage(async () => {
			return {
				coverage: { '/ext/src/a.ts': { hash: 'h2', s: { 0: 1 }, f: {}, b: {} } },
				coverageDirs,
			};
		});

		await reloadedModule.dumpCoverage();

		await expect(readFile(
			join(workDir, 'ext/cov', reloadedModule.COVERAGE_DUMP_NAME),
			'utf8',
		)).resolves.toBe(JSON.stringify({
			'/ext/src/a.ts': { hash: 'h2', s: { 0: 1 }, f: {}, b: {} },
		}));
	});

	test('gives a reused pid a new file', async () => {
		expect(COVERAGE_DUMP_NAME).toMatch(
			new RegExp(`^cov-${process.pid}-\\d+\\.json$`),
		);

		vi.resetModules();
		const reloadedModule = await import('./dump-coverage.js');

		expect(reloadedModule.COVERAGE_DUMP_NAME).not.toBe(COVERAGE_DUMP_NAME);
	});
});
