import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
} from '@common/cucumber';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const feature = loadFeature(
	'./tests/common/harness/sequential-gate-completion.feature',
);

const fixturesDir = join(
	dirname(fileURLToPath(import.meta.url)),
	'completion-fixtures',
);

const vitestBin = join(
	dirname(createRequire(import.meta.url).resolve('vitest/package.json')),
	'vitest.mjs',
);

describe('sequential gate', () => {
	// Stands in for the instance the gate reports to: it counts the completions
	// posted to `tests_flow_completed` and answers the gate's count with them.
	const completedFiles: string[] = [];
	let completionServer: Server;

	beforeAll(async () => {
		completionServer = createServer((request, response) => {
			let body = '';
			request.on('data', (chunk) => (body += chunk));

			request.on('end', () => {
				if (request.method === 'POST') {
					completedFiles.push(JSON.parse(body).test_file_path);
				}

				response.setHeader('Content-Type', 'application/json');

				response.end(JSON.stringify({
					data: [{ count: { id: completedFiles.length } }],
				}));
			});
		});

		completionServer.listen(0, '127.0.0.1');
		await once(completionServer, 'listening');
	});

	afterAll(() => {
		completionServer.close();
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'a skipped file and a file that fails to load report like a passing one',
			({ given, when, then }) => {
				let shardDir: string;
				let shardFiles: string[];

				given('a shard of these files:', async (table) => {
					shardFiles = parseGherkinTable<{ file: string }>(table).map((row) => {
						return row.file;
					});

					// The gate reads the shard's file count from its working directory.
					shardDir = await mkdtemp(join(tmpdir(), 'gate-completion-'));

					await writeFile(join(shardDir, 'sequencer-data.json'), JSON.stringify({
						totalTestsCount: shardFiles.length,
						beforeFiles: [],
						afterFiles: [],
					}));
				});

				when(
					"the shard runs with the suite's setup files and reporters",
					async () => {
						const { port } = completionServer.address() as AddressInfo;

						await once(spawn(process.execPath, [
							vitestBin,
							'run',
							'--config', join(fixturesDir, 'vitest.config.ts'),
						], {
							cwd: shardDir,
							env: {
								...process.env,
								serverUrl: `http://127.0.0.1:${port}`,
							},
							stdio: 'inherit',
						}), 'exit');
					},
				);

				then('each of them posted its completion', () => {
					expect(new Set(completedFiles)).toEqual(new Set([
						'/tests/common/harness/completion-fixtures/passing.fixture.ts',
						'/tests/common/harness/completion-fixtures/skipped.fixture.ts',
						'/tests/common/harness/completion-fixtures/broken.fixture.ts',
					]));
				});
			},
			60_000,
		);
	});
});
