import { getUrl, paths } from '@common/config';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { sleep } from '@utils/sleep';
import { spawn } from 'child_process';
import { createReadStream } from 'fs';
import { join } from 'path';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

const assetsDirectory = [paths.cwd, 'assets'];
const storages = ['local', 'minio'];
const imageFilePath = join(...assetsDirectory, 'layers.png');

describe('/assets', () => {
	describe('GET /assets/:id', () => {
		describe('Concurrent file requests', () => {
			describe.each(storages)('Storage: %s', (storage) => {
				it.each(vendors)(
					'%s',
					async (vendor) => {
						// Setup
						const spawnCountTarget = 5;
						let spawnCount = 0;
						let failedRound: Record<string, unknown> | null = null;
						let isSpawnRunning = false;

						const insertResponse = await request(getUrl(vendor))
							.post('/files')
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
							.field('storage', storage)
							.attach('file', createReadStream(imageFilePath))
							.expect(200);

						// Action
						spawnAutoCannon();

						function spawnAutoCannon() {
							const url = `${getUrl(vendor)}/assets/${insertResponse.body.data.id}?access_token=${USER.ADMIN.TOKEN}`;

							const options = ['exec', 'autocannon', '-j', '-c', '100', url];
							const child = spawn('pnpm', options);

							isSpawnRunning = true;

							let log = '';

							child.stdout.on('data', (data) => {
								log += String(data);
							});

							child.on('close', () => {
								spawnCount++;

								const result = JSON.parse(log);

								// autocannon's errors counts timeouts and connections that broke
								// before any answer (ECONNRESET, ECONNREFUSED…).
								if (result.errors > 0 || result.non2xx > 0) {
									failedRound = {
										round: spawnCount,
										requests: result.requests.total,
										errors: result.errors,
										timeouts: result.timeouts,
										non2xx: result.non2xx,
										'4xx': result['4xx'],
										'5xx': result['5xx'],
										statusCodeStats: result.statusCodeStats,
									};
								}

								if (spawnCount < spawnCountTarget && failedRound === null) {
									spawnAutoCannon();
								} else {
									isSpawnRunning = false;
								}
							});
						}

						while (isSpawnRunning) {
							await sleep(1000 * spawnCountTarget);
						}

						// Assert
						// The autocannon numbers of the round that failed, so a red run
						// says whether it timed out, broke connections or answered non-2xx.
						expect(failedRound).toBeNull();
					},
					600_000,
				);
			});
		});
	});
});
