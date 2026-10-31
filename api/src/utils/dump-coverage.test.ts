import {
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
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
	test('sends an extension its own files and core the rest', () => {
		const split = splitCoverage(
			{
				'/repo/ext-a/src/a.ts': 'a',
				'/repo/ext-ab/src/b.ts': 'ab',
				'src/controllers/server.ts': 'core',
			},
			[{ sourceRoot: '/repo/ext-a', coverageDir: '/repo/ext-a/coverage' }],
			'/cov/core',
		);

		expect(split).toEqual({
			coverageByDir: new Map([
				['/repo/ext-a/coverage', { '/repo/ext-a/src/a.ts': 'a' }],
				[
					'/cov/core',
					{
						'/repo/ext-ab/src/b.ts': 'ab',
						'src/controllers/server.ts': 'core',
					},
				],
			]),
			unownedCount: 0,
		});
	});

	test('counts the files no extension owns when there is no core directory', () => {
		const split = splitCoverage(
			{ '/repo/ext-a/src/a.ts': 'a', '/repo/shared/y.ts': 'y' },
			[{ sourceRoot: '/repo/ext-a', coverageDir: '/repo/ext-a/coverage' }],
			undefined,
		);

		expect(split).toEqual({
			coverageByDir: new Map([
				['/repo/ext-a/coverage', { '/repo/ext-a/src/a.ts': 'a' }],
			]),
			unownedCount: 1,
		});
	});
});

describe('readExtensionCoverageDirs', () => {
	test('reads nothing when no instrumented extension is loaded', () => {
		expect(readExtensionCoverageDirs()).toEqual([]);
	});

	test('lists a package nested in another one first, to own its own files', () => {
		(globalThis as Record<string, unknown>)['__extensionCoverageDirs'] = [
			{ sourceRoot: '/repo/outer', coverageDir: '/repo/outer/cov' },
			{ sourceRoot: '/repo/outer/inner', coverageDir: '/repo/outer/inner/cov' },
		];

		expect(readExtensionCoverageDirs()).toEqual([
			{ sourceRoot: '/repo/outer/inner', coverageDir: '/repo/outer/inner/cov' },
			{ sourceRoot: '/repo/outer', coverageDir: '/repo/outer/cov' },
		]);
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
			{ sourceRoot: join(workDir, 'ext'), coverageDir: join(workDir, 'ext/cov') },
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

	test('runs two dumps asked at once one after the other', async () => {
		vi.stubEnv('COVERAGE_DIR', join(workDir, 'core'));
		(globalThis as Record<string, unknown>)['__coverage__'] = { 'src/app.ts': {} };

		// Run together, both would rename the same `.partial` and one would fail.
		await expect(Promise.all([dumpCoverage(), dumpCoverage()])).resolves.toEqual([
			[{ dir: join(workDir, 'core'), fileCount: 1 }],
			[{ dir: join(workDir, 'core'), fileCount: 1 }],
		]);
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
