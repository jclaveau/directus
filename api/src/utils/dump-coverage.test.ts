import type { Extension } from '@directus/types';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
	COVERAGE_DUMP_NAME,
	dumpCoverage,
	listCoveredExtensions,
	splitCoverage,
	startCoverageFlush,
} from './dump-coverage.js';

const { env, logger, extensionManager } = vi.hoisted(() => {
	return {
		env: {} as Record<string, unknown>,
		logger: { warn: vi.fn(), error: vi.fn() },
		extensionManager: { extensions: [] as unknown[] },
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => env }));
vi.mock('../logger/index.js', () => ({ useLogger: () => logger }));

vi.mock('../extensions/index.js', () => {
	return { getExtensionManager: () => extensionManager };
});

let workDir: string;

beforeEach(async () => {
	workDir = await mkdtemp(join(tmpdir(), 'dump-coverage-'));
});

afterEach(async () => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
	delete (globalThis as Record<string, unknown>)['__coverage__'];
	extensionManager.extensions = [];

	for (const key of Object.keys(env)) {
		delete env[key];
	}

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
			[{ realPath: '/repo/ext-a', coverageDir: '/repo/ext-a/coverage' }],
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
			[{ realPath: '/repo/ext-a', coverageDir: '/repo/ext-a/coverage' }],
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

describe('listCoveredExtensions', () => {
	test('reads an extension loaded through a symlink at its real path', async () => {
		await mkdir(join(workDir, 'packages/ext'), { recursive: true });
		await mkdir(join(workDir, 'node_modules'));

		await symlink(
			join(workDir, 'packages/ext'),
			join(workDir, 'node_modules/ext'),
		);

		const coveredExtensions = await listCoveredExtensions([
			{
				name: 'ext',
				path: join(workDir, 'node_modules/ext'),
				coverage: 'coverage/.tmp/backend',
			},
			{ name: 'uncovered', path: join(workDir, 'missing') },
		] as Extension[]);

		expect(coveredExtensions).toEqual([
			{
				realPath: join(workDir, 'packages/ext'),
				coverageDir: join(workDir, 'packages/ext/coverage/.tmp/backend'),
			},
		]);
	});

	test('skips an extension whose path no longer exists, with a warning', async () => {
		await mkdir(join(workDir, 'ext'));

		const coveredExtensions = await listCoveredExtensions([
			{ name: 'gone', path: join(workDir, 'gone'), coverage: 'cov' },
			{ name: 'ext', path: join(workDir, 'ext'), coverage: 'cov' },
		] as Extension[]);

		expect(coveredExtensions).toEqual([
			{ realPath: join(workDir, 'ext'), coverageDir: join(workDir, 'ext/cov') },
		]);

		expect(logger.warn).toHaveBeenCalledWith(
			'Coverage of extension "gone" not written to its own '
				+ `directory: ${join(workDir, 'gone')} no longer exists.`,
		);
	});

	test('lets a nested package own its own files', async () => {
		await mkdir(join(workDir, 'outer/inner'), { recursive: true });

		const coveredExtensions = await listCoveredExtensions([
			{ name: 'outer', path: join(workDir, 'outer'), coverage: 'cov' },
			{ name: 'inner', path: join(workDir, 'outer/inner'), coverage: 'cov' },
		] as Extension[]);

		expect(splitCoverage(
			{ [join(workDir, 'outer/inner/src/i.ts')]: 'i' },
			coveredExtensions,
			undefined,
		).coverageByDir).toEqual(new Map([
			[
				join(workDir, 'outer/inner/cov'),
				{ [join(workDir, 'outer/inner/src/i.ts')]: 'i' },
			],
		]));
	});
});

describe('dumpCoverage', () => {
	test('writes nothing when nothing loaded is instrumented', async () => {
		vi.stubEnv('COVERAGE_DIR', join(workDir, 'core'));

		expect(await dumpCoverage()).toEqual([]);
		await expect(readdir(workDir)).resolves.toEqual([]);
	});

	test('writes each directory its own files, one file per process', async () => {
		await mkdir(join(workDir, 'ext'));
		vi.stubEnv('COVERAGE_DIR', join(workDir, 'core'));

		extensionManager.extensions = [
			{ name: 'ext', path: join(workDir, 'ext'), coverage: 'coverage' },
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
			{ dir: join(workDir, 'ext/coverage'), fileCount: 1 },
			{ dir: join(workDir, 'core'), fileCount: 1 },
		]);

		// Overwritten, not added: the merge would sum two snapshots of one process.
		await expect(readdir(join(workDir, 'ext/coverage')))
			.resolves.toEqual([COVERAGE_DUMP_NAME]);

		await expect(readdir(join(workDir, 'core')))
			.resolves.toEqual([COVERAGE_DUMP_NAME]);

		await expect(readFile(join(workDir, 'ext/coverage', COVERAGE_DUMP_NAME), 'utf8'))
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
			'Coverage of 2 source files not written: no extension declaring a '
				+ 'coverage directory owns them, and COVERAGE_DIR is unset.',
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

describe('startCoverageFlush', () => {
	test('dumps on an unref timer every COVERAGE_FLUSH_INTERVAL', () => {
		env['COVERAGE_FLUSH_INTERVAL'] = '10s';
		(globalThis as Record<string, unknown>)['__coverage__'] = {};
		const unref = vi.fn();

		const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
			.mockReturnValue({ unref } as unknown as NodeJS.Timeout);

		startCoverageFlush();

		expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10_000);
		expect(unref).toHaveBeenCalledOnce();
	});

	test('logs a failed flush instead of throwing it', async () => {
		env['COVERAGE_FLUSH_INTERVAL'] = '10s';
		(globalThis as Record<string, unknown>)['__coverage__'] = { 'src/app.ts': {} };
		await writeFile(join(workDir, 'file'), '');
		vi.stubEnv('COVERAGE_DIR', join(workDir, 'file/core'));

		const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
			.mockReturnValue({ unref: vi.fn() } as unknown as NodeJS.Timeout);

		startCoverageFlush();
		const flush = setIntervalSpy.mock.calls[0]![0] as () => void;
		flush();

		await vi.waitFor(() => {
			expect(logger.error).toHaveBeenCalledWith(
				expect.objectContaining({ code: 'ENOTDIR' }),
				'Coverage flush failed',
			);
		});
	});

	test.each([
		['the interval is 0', '0', {}],
		['nothing is instrumented', '10s', undefined],
	])('starts no timer when %s', (_case, flushInterval, coverage) => {
		env['COVERAGE_FLUSH_INTERVAL'] = flushInterval;
		(globalThis as Record<string, unknown>)['__coverage__'] = coverage;
		const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');

		startCoverageFlush();

		expect(setIntervalSpy).not.toHaveBeenCalled();
	});
});
