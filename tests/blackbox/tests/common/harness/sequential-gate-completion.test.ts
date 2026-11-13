import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
} from '@common/cucumber';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
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
	const shardDirs: string[] = [];
	let completionServer: Server;
	let losesNextAnswer = false;

	beforeAll(async () => {
		completionServer = createServer((request, response) => {
			let body = '';
			request.on('data', (chunk) => (body += chunk));

			request.on('end', () => {
				const { searchParams } = new URL(request.url!, 'http://localhost');
				const postedPath = searchParams.get('filter[test_file_path][_eq]');

				if (request.method === 'POST') {
					completedFiles.push(JSON.parse(body).test_file_path);

					// Recorded, then the connection drops before the answer leaves.
					if (losesNextAnswer) {
						losesNextAnswer = false;
						request.socket.destroy();
						return;
					}
				}

				response.setHeader('Content-Type', 'application/json');

				if (postedPath !== null) {
					response.end(JSON.stringify({
						data: completedFiles
							.filter((file) => file === postedPath)
							.map((file) => ({ test_file_path: file })),
					}));

					return;
				}

				response.end(JSON.stringify({
					data: [{ count: { id: completedFiles.length } }],
				}));
			});
		});

		completionServer.listen(0, '127.0.0.1');
		await once(completionServer, 'listening');
	});

	afterAll(async () => {
		completionServer.close();

		await Promise.all(shardDirs.map((shardDir) => {
			return rm(shardDir, { recursive: true, force: true });
		}));
	});

	async function writeShard(table: Record<string, string>[]) {
		completedFiles.length = 0;

		// The gate reads the shard's file count from its working directory.
		const shardDir = await mkdtemp(join(tmpdir(), 'gate-completion-'));
		shardDirs.push(shardDir);

		await writeFile(join(shardDir, 'sequencer-data.json'), JSON.stringify({
			totalTestsCount: parseGherkinTable<{ file: string }>(table).length,
			beforeFiles: [],
			afterFiles: [],
		}));

		return shardDir;
	}

	async function runShard(shardDir: string) {
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
			// A shard left waiting on the gate is killed and reaped inside
			// the scenario's 60s, not left running to the gate's timeout.
			timeout: 50_000,
		}), 'exit');
	}

	function expectEachPostedOnce() {
		// Once each: the gate counts posts, so a duplicate would open it early.
		expect(completedFiles).toHaveLength(3);

		expect(completedFiles).toEqual(expect.arrayContaining([
			'/tests/common/harness/completion-fixtures/passing.fixture.ts',
			'/tests/common/harness/completion-fixtures/skipped.fixture.ts',
			'/tests/common/harness/completion-fixtures/broken.fixture.ts',
		]));
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a skipped file and a file that fails to load report like a passing one',
			({ given, when, then }) => {
				let shardDir: string;

				given('a shard of these files:', async (table) => {
					shardDir = await writeShard(table);
				});

				when(
					"the shard runs with the suite's setup files and reporters",
					() => runShard(shardDir),
				);

				then('each of them posted its completion', expectEachPostedOnce);
			},
			60_000,
		);

		scenario(
			'a completion whose answer is lost is not posted again',
			({ given, and, when, then }) => {
				let shardDir: string;

				given('a shard of these files:', async (table) => {
					shardDir = await writeShard(table);
				});

				and('the answer to the first completion posted is lost', () => {
					losesNextAnswer = true;
				});

				when(
					"the shard runs with the suite's setup files and reporters",
					() => runShard(shardDir),
				);

				then('each of them posted its completion', expectEachPostedOnce);
			},
			60_000,
		);
	});
});
