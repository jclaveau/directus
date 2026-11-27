import config, { getUrl, paths } from '@common/config';
import {
	cellOfKnownKeys,
	defineFeature,
	loadFeature,
	responseCellOf,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { sleep } from '@utils/sleep';
import { stopSpawnedInstance } from '@utils/stop-spawned-instance';
import { type ChildProcess, spawn } from 'child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { afterEach, describe, expect } from 'vitest';

const feature = loadFeature(
	'./tests/db/routes/server/out-of-scope-features.feature',
);

type VariableRow = { variable: string; value: string };
type ErrorsRow = { errors: string };
type Row = { request: string; response: string };

type RequestCell = {
	method: 'GET' | 'POST';
	path: string;
	payload?: object;
};

type ResponseCell = { code?: number; body?: unknown; text?: string };

const REQUEST_CELL_KEYS = ['method', 'path', 'payload'] as const;
const RESPONSE_CELL_KEYS = ['code', 'body', 'text'] as const;

// pino's number for the error level; fatal is above it.
const ERROR_LEVEL = 50;

// An instance that neither answers its ping nor exits by then is left to the
// step after, which fails on it.
const START_DEADLINE_MS = 30_000;

const RELOAD_DEADLINE_MS = 20_000;

type StartedInstance = {
	process: ChildProcess;
	url: string;
	stdout: string;
	stderr: string;
	exitCode: number | null | undefined;
};

describe.each(vendors)('%s', (vendor) => {
	let startedInstance: StartedInstance | undefined;
	let packageFolder: string | undefined;

	afterEach(async () => {
		await stopSpawnedInstance(startedInstance?.process);
		startedInstance = undefined;

		if (packageFolder !== undefined) {
			await rm(packageFolder, { recursive: true, force: true });
			packageFolder = undefined;
		}
	}, 60_000);

	// Resolves once the instance answers its ping, exits, or the deadline
	// passes, whichever comes first.
	async function startInstance(variables: VariableRow[]) {
		const env = cloneDeep(config.envs);
		const port = await freePortOfWorker();
		env[vendor].PORT = String(port);
		env[vendor]['PUBLIC_URL'] = getUrl(vendor, env);
		env[vendor]['LOG_STYLE'] = 'raw';

		for (const { variable, value } of variables) {
			env[vendor][variable] = value.replaceAll(
				'<package_folder>',
				() => {
					if (packageFolder === undefined) {
						throw new Error(
							'"<package_folder>" names no folder: no Given step made one',
						);
					}

					return packageFolder;
				},
			);
		}

		const instance: StartedInstance = {
			process: spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			}),
			url: getUrl(vendor, env),
			stdout: '',
			stderr: '',
			exitCode: undefined,
		};

		startedInstance = instance;

		instance.process.stdout!.on('data', (chunk) => {
			instance.stdout += String(chunk);
		});

		instance.process.stderr!.on('data', (chunk) => {
			instance.stderr += String(chunk);
		});

		// Not `exit`: that can fire before the last log line is read.
		instance.process.on('close', (code) => {
			instance.exitCode = code;
		});

		const startedAt = Date.now();

		while (
			instance.exitCode === undefined
			&& Date.now() - startedAt < START_DEADLINE_MS
		) {
			try {
				const ping = await fetch(`${instance.url}/server/ping`);

				if (ping.ok) {
					return;
				}
			}
			catch {
				// Not listening yet: the loop tries again until the deadline.
			}

			await sleep(200);
		}
	}

	function runningInstance() {
		if (startedInstance === undefined || startedInstance.exitCode !== undefined) {
			throw new Error(
				`The instance is not running: it exited with code `
				+ `${JSON.stringify(startedInstance?.exitCode)}\n`
				+ `${startedInstance?.stdout}${startedInstance?.stderr}`,
			);
		}

		return startedInstance;
	}

	async function receivedResponse(instanceUrl: string, row: Row) {
		const requestCell = cellOfKnownKeys<RequestCell>(
			'request',
			loadYaml(row.request),
			REQUEST_CELL_KEYS,
			'out-of-scope-features.test.ts',
		);

		const expectedResponse = responseCellOf<ResponseCell>(
			loadYaml(row.response),
			RESPONSE_CELL_KEYS,
			'out-of-scope-features.test.ts',
		);

		const pendingRequest = requestCell.method === 'GET'
			? request(instanceUrl).get(requestCell.path)
			: request(instanceUrl).post(requestCell.path);

		const response = requestCell.payload === undefined
			? await pendingRequest
			: await pendingRequest.send(requestCell.payload);

		return {
			expectedResponse,
			receivedPart: {
				code: response.statusCode,
				body: response.body,
				...(expectedResponse.text === undefined
					? {}
					: { text: response.text }),
			},
		};
	}

	// The file the package's manifest names; rewriting it is what the watcher
	// of an auto-reloading instance sees.
	function endpointSource(answer: string) {
		return 'export default (router) => {\n'
			+ `\trouter.get('/', (_req, res) => res.send(${JSON.stringify(answer)}));\n`
			+ '};\n';
	}

	defineFeature(feature, (scenario) => {
		for (const { title } of feature.scenarios) {
			scenario(title, ({ given, when, then }) => {
				given.optional(
					/^the package "([\w-]+)" holds an endpoint answering "(\w+)"$/,
					async (packageName: string, answer: string) => {
						packageFolder = await mkdtemp(join(tmpdir(), 'out-of-scope-'));
						const packagePath = join(packageFolder, 'node_modules', packageName);
						await mkdir(packagePath, { recursive: true });

						await writeFile(
							join(packageFolder, 'package.json'),
							JSON.stringify({
								name: 'out-of-scope-reload',
								private: true,
								dependencies: { [packageName]: '0.0.0' },
							}),
						);

						await writeFile(
							join(packagePath, 'package.json'),
							JSON.stringify({
								'name': packageName,
								'version': '0.0.0',
								'type': 'module',
								'directus:extension': {
									type: 'endpoint',
									path: 'index.mjs',
									source: 'index.mjs',
									host: '^10.10.0',
								},
							}),
						);

						await writeFile(join(packagePath, 'index.mjs'), endpointSource(answer));
					},
				);

				when(
					'an instance starts with these variables:',
					async (table: VariableRow[]) => {
						await startInstance(table);
					},
				);

				then.optional(
					'it exits with code 1, logging these errors:',
					(table: ErrorsRow[]) => {
						const exitedInstance = startedInstance!;
						const output = exitedInstance.stdout + exitedInstance.stderr;

						expect(exitedInstance.exitCode, output).toBe(1);

						const loggedErrors = exitedInstance.stdout
							.split('\n')
							.filter((line) => line.startsWith('{'))
							.map((line) => JSON.parse(line) as { level: number; msg: string })
							.filter((logLine) => logLine.level >= ERROR_LEVEL)
							.map((logLine) => logLine.msg);

						expect(loggedErrors, output).toEqual(
							table.flatMap((row) => loadYaml(row.errors) as string[]),
						);
					},
				);

				then.optional(
					'these requests get these responses:',
					async (table: Row[]) => {
						const instance = runningInstance();

						for (const row of table) {
							const { expectedResponse, receivedPart } = await receivedResponse(
								instance.url,
								row,
							);

							expect(receivedPart).toMatchObject(expectedResponse);
						}
					},
				);

				when.optional(
					/^the endpoint of "([\w-]+)" is rewritten to answer "(\w+)"$/,
					async (packageName: string, answer: string) => {
						await writeFile(
							join(packageFolder!, 'node_modules', packageName, 'index.mjs'),
							endpointSource(answer),
						);
					},
				);

				// The watcher reloads a debounce after the change, so a row is sent
				// again until it matches or the deadline passes.
				then.optional(
					'these requests get these responses within 20 seconds:',
					async (table: Row[]) => {
						const instance = runningInstance();
						const startedAt = Date.now();

						for (const row of table) {
							for (;;) {
								const { expectedResponse, receivedPart } = await receivedResponse(
									instance.url,
									row,
								);

								try {
									expect(receivedPart).toMatchObject(expectedResponse);
									break;
								}
								catch (mismatch) {
									if (Date.now() - startedAt > RELOAD_DEADLINE_MS) {
										throw mismatch;
									}
								}

								await sleep(250);
							}
						}
					},
				);
			}, 90_000);
		}
	});
});
