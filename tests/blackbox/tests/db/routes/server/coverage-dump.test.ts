import config, { paths, type Env } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
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
 * What istanbul records for a file with nothing in it, set the way an
 * instrumented module sets it: on the global, when the module loads.
 */
const FIXTURE_HOOK = `
import { fileURLToPath } from 'node:url';

const sourceFile = fileURLToPath(new URL('./src/index.js', import.meta.url));

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
			'an extension declaring a coverage directory receives its own files',
			({ given, and, when, then }) => {
				let extensionsPath: string;
				let extensionPath: string;
				let port: number;
				let response: request.Response;

				given(
					/^an extension declaring the coverage directory (\S+)$/,
					async (coverageDir: string) => {
						extensionsPath = await realpath(await mkdtemp(
							join(tmpdir(), 'directus-blackbox-coverage-'),
						));

						directories.push(extensionsPath);
						extensionPath = join(extensionsPath, 'coverage-fixture');
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
									coverage: coverageDir,
								},
							}),
						);

						await writeFile(join(extensionPath, 'index.js'), FIXTURE_HOOK);
						await writeFile(join(extensionPath, 'src/index.js'), '');
					},
				);

				and('a server runs with that extension', async () => {
					const env = cloneDeep(config.envs) as { [vendor: string]: Env };
					env[vendor]['EXTENSIONS_PATH'] = extensionsPath;
					port = await getPort();
					env[vendor].PORT = String(port);

					instances.push(spawn('node', [paths.cli, 'start'], {
						cwd: paths.cwd,
						env: env[vendor],
					}));

					await awaitDirectusConnection(port);
				});

				when('the coverage is asked for with POST /server/coverage', async () => {
					response = await request(`http://127.0.0.1:${port}`)
						.post('/server/coverage');
				});

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
