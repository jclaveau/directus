import config, { paths, type Env } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { awaitDirectusConnection } from '@utils/await-connection';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { writeExtensionPackage } from '@utils/write-extension-package';
import { ChildProcess, spawn } from 'child_process';
import { cloneDeep } from 'lodash-es';
import {
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	realpath,
	rm,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, describe, expect } from 'vitest';

const feature = loadFeature('./tests/db/routes/server/coverage-dump.feature');

/**
 * A hand-written stand-in for what `directus-extension build` with `coverage`
 * emits: it registers the package's coverage directory and the files bundled
 * into it on the same global, then records what istanbul records for a file
 * with nothing in it. It is not the SDK's banner, which its own unit tests
 * run; this proves the server routes a registered directory through the real
 * extension loader.
 */
function renderFixtureHook(coverageDir: string): string {
	return `
import { fileURLToPath } from 'node:url';

const sourceRoot = fileURLToPath(new URL('.', import.meta.url)).slice(0, -1);
const sourceFile = fileURLToPath(new URL('./src/index.js', import.meta.url));

(globalThis.__extensionCoverageDirs ??= []).push({
	sourceRoot,
	coverageDir: sourceRoot + '/' + ${JSON.stringify(coverageDir)},
	sourceFiles: [sourceFile],
});

globalThis.__coverage__ ??= {};

globalThis.__coverage__[sourceFile] = {
	path: sourceFile,
	statementMap: {},
	fnMap: {},
	branchMap: {},
	s: {},
	f: {},
	b: {},
};

export default () => {};
`;
}

describe.each(vendors)('%s', (vendor) => {
	const instances: ChildProcess[] = [];
	const directories: string[] = [];

	afterAll(async () => {
		// Its shutdown dump writes into the fixture: let it finish before removing it.
		await Promise.all(instances.map((instance) => {
			return new Promise((resolve) => {
				if (instance.exitCode !== null || instance.signalCode !== null) {
					resolve(undefined);
					return;
				}

				instance.once('exit', resolve);
				instance.kill();
			});
		}));

		for (const directory of directories) {
			await rm(directory, { recursive: true, force: true });
		}
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'an extension built with coverage receives its own files',
			({ given, and, when, then }) => {
				let packagePath: string;
				let extensionPath: string;
				let port: number;
				let response: request.Response;

				given(
					/^an extension built with the coverage directory (\S+)$/,
					async (coverageDir: string) => {
						packagePath = await realpath(await mkdtemp(
							join(tmpdir(), 'directus-blackbox-coverage-'),
						));

						directories.push(packagePath);
						extensionPath = join(packagePath, 'coverage-fixture');
						await mkdir(join(extensionPath, 'src'), { recursive: true });

						await writeFile(
							join(extensionPath, 'package.json'),
							JSON.stringify({
								name: 'directus-extension-coverage-fixture',
								version: '1.0.0',
								type: 'module',
								'directus:extension': {
									type: 'hook',
									path: 'index.js',
									source: 'src/index.js',
									host: '^11.0.0',
								},
							}),
						);

						await writeFile(
							join(extensionPath, 'index.js'),
							renderFixtureHook(coverageDir),
						);

						await writeFile(join(extensionPath, 'src/index.js'), '');

						await writeExtensionPackage(packagePath, {
							'directus-extension-coverage-fixture': extensionPath,
						});
					},
				);

				and('a server runs with that extension', async () => {
					const env = cloneDeep(config.envs) as { [vendor: string]: Env };
					env[vendor]['PACKAGE_FILE_LOCATION'] = packagePath;
					port = await freePortOfWorker();
					env[vendor].PORT = String(port);

					instances.push(spawn('node', [paths.cli, 'start'], {
						cwd: paths.cwd,
						env: env[vendor],
					}));

					await awaitDirectusConnection(port);
				});

				when(
					'the coverage is asked for with POST /server/dump-coverage',
					async () => {
						response = await request(`http://127.0.0.1:${port}`)
							.post('/server/dump-coverage');
					},
				);

				then(
					/^the answer lists (\d+) file written into the extension's coverage directory$/,
					(fileCount: string) => {
						expect(response.statusCode).toBe(200);

						const extensionWritten = {
							dir: join(extensionPath, 'coverage/.tmp/backend'),
							fileCount: Number(fileCount),
						};

						// An instrumented build (COVERAGE_DIR in CI) also writes the core's,
						// first: core modules load before the extension does.
						if (process.env['COVERAGE_DIR']) {
							expect(response.body.data.written).toEqual([
								{
									dir: process.env['COVERAGE_DIR'],
									fileCount: expect.any(Number),
								},
								extensionWritten,
							]);
						}
						else {
							expect(response.body.data.written).toEqual([extensionWritten]);
						}
					},
				);

				and(
					/^that directory holds one coverage file, with the coverage of (\S+)$/,
					async (sourceFile: string) => {
						const coverageDir = join(extensionPath, 'coverage/.tmp/backend');
						const dumpFiles = await readdir(coverageDir);

						expect(dumpFiles).toEqual([
							expect.stringMatching(/^cov-\d+-\d+\.json$/),
						]);

						const dumpCoverage = JSON.parse(
							await readFile(join(coverageDir, dumpFiles[0]!), 'utf8'),
						);

						expect(Object.keys(dumpCoverage)).toEqual([
							join(extensionPath, sourceFile),
						]);
					},
				);
			},
			180_000,
		);
	});
});
