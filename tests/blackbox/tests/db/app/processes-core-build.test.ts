import config, { paths } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import { gunzipSync } from 'node:zlib';
import { afterAll, describe, expect } from 'vitest';

const feature = loadFeature('./tests/db/app/processes-core-build.feature');

describe.each(vendors)('%s', (vendor) => {
	// Its own namespace, so its own bus: no other suite's process answers here.
	const namespace = `directus-processes-core-build-${vendor}`;
	const reportChannel = `${namespace}:bus:processes:report`;
	const instances: ChildProcess[] = [];
	const listener = new Redis({ host: 'localhost', port: 6108 });
	const publisher = new Redis({ host: 'localhost', port: 6108 });

	afterAll(async () => {
		for (const instance of instances) {
			instance.kill();
		}

		listener.disconnect();
		await publisher.quit();
	});

	defineFeature(feature, (scenario) => {
		scenario(
			'two processes of two builds each answer with their own build',
			({ given, and, when, then }) => {
				const answers: Record<string, unknown>[] = [];

				async function spawnProcess(buildId: string, replica: string) {
					const env = cloneDeep(config.envs);
					env[vendor]['REDIS_HOST'] = 'localhost';
					env[vendor]['REDIS_PORT'] = '6108';
					env[vendor]['CACHE_NAMESPACE'] = namespace;
					env[vendor]['CACHE_BUILD_ID'] = buildId;
					env[vendor]['RAILWAY_REPLICA_ID'] = `${vendor}-${replica}`;
					env[vendor].PORT = String(await getPort());

					instances.push(spawn('node', [paths.cli, 'start'], {
						cwd: paths.cwd,
						env: env[vendor],
					}));

					await awaitDirectusConnection(Number(env[vendor].PORT));
				}

				given(
					/^a process runs on the build ([\w-]+) as the replica (\w+)$/,
					spawnProcess,
				);

				and(
					/^a process runs on the build ([\w-]+) as the replica (\w+)$/,
					spawnProcess,
				);

				// The bus sends a message as its JSON, gzipped from 1000 bytes on.
				when(
					'the processes are asked on the bus to describe themselves',
					async () => {
						const requestId = randomUUID();

						listener.on('messageBuffer', (_channel: Buffer, message: Buffer) => {
							const gzipped = message[0] === 0x1f && message[1] === 0x8b;

							const answer = JSON.parse(String(gzipped
								? gunzipSync(message)
								: message));

							if (answer.requestId === requestId) {
								answers.push(answer);
							}
						});

						await listener.subscribe(reportChannel);

						await publisher.publish(
							`${namespace}:bus:processes:query`,
							JSON.stringify({ requestId, details: [] }),
						);

						await expect.poll(() => answers.length, { timeout: 10_000 })
							.toBe(2);
					},
				);

				then(
					'these replicas answered:',
					(table: Record<string, string>[]) => {
						expect(answers).toHaveLength(table.length);

						for (const row of table) {
							expect(answers).toContainEqual(expect.objectContaining({
								replicaId: `${vendor}-${row['replica']}`,
								self: expect.objectContaining({ coreBuildId: row['build'] }),
							}));
						}
					},
				);
			},
			120_000,
		);
	});
});
