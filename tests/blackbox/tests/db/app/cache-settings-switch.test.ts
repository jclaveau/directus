import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	type StepFunctions,
} from '@common/cucumber';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import {
	afterAll,
	afterEach,
	beforeAll,
	describe,
	expect,
} from 'vitest';

const NOTE = 'cache_settings_switch_note';
const cacheStatusHeader = 'x-cache-status';

const feature = loadFeature('./tests/db/app/cache-settings-switch.feature');

describe.each(vendors)('%s', (vendor) => {
	const readerNamespace = `directus-cache-settings-switch-${vendor}`;
	const flushNamespace = `${readerNamespace}-cli`;

	const readerEnv = cloneDeep(config.envs);
	readerEnv[vendor]['CACHE_ENABLED'] = 'false';
	readerEnv[vendor]['CACHE_STATUS_HEADER'] = cacheStatusHeader;
	readerEnv[vendor]['CACHE_AUTO_PURGE'] = 'true';
	readerEnv[vendor]['CACHE_STORE'] = 'redis';
	readerEnv[vendor]['REDIS_HOST'] = 'localhost';
	readerEnv[vendor]['REDIS_PORT'] = '6108';
	readerEnv[vendor]['CACHE_NAMESPACE'] = readerNamespace;
	readerEnv[vendor]['BUS_NAMESPACE'] = `${readerNamespace}:bus`;

	// Deaf to the reader's announcements, and a day away from re-reading the
	// setting on its own.
	const laggingEnv = cloneDeep(readerEnv);
	laggingEnv[vendor]['BUS_NAMESPACE'] = `${readerNamespace}:lagging-bus`;
	laggingEnv[vendor]['SHARED_SETTINGS_POLL_SECONDS'] = '86400';

	// The shape `@keyv/redis` files a Keyv entry under: the store prefixes the key
	// Keyv already prefixed, both with the tier's namespace.
	const readerEntryKey
		= `${readerNamespace}_response::${readerNamespace}_response:switch-witness`;

	const flushEntryKey
		= `${flushNamespace}_response::${flushNamespace}_response:switch-witness`;

	const sharedRedis = new Redis({ host: 'localhost', port: 6108 });
	const adminAuth = `Bearer ${USER.ADMIN.TOKEN}`;
	const spawnedInstances: ChildProcess[] = [];
	let flushRun: { code: number | null; output: string } | undefined;
	let lastResponse: request.Response | undefined;
	let noteId: number;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [{
				collection: NOTE,
				fields: [{ field: 'label', type: 'string', meta: {} }],
			}],
		});

		noteId = (await CreateItem(vendor, {
			collection: NOTE,
			item: { label: 'v1' },
		})).id;

		const bootedNodes = [];

		for (const nodeEnv of [readerEnv, laggingEnv]) {
			const nodePort = await getPort();
			nodeEnv[vendor].PORT = String(nodePort);

			spawnedInstances.push(spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: nodeEnv[vendor],
			}));

			bootedNodes.push(awaitDirectusConnection(nodePort));
		}

		await Promise.all(bootedNodes);
	}, 180_000);

	// The layer lives in the settings singleton every later suite boots on.
	afterEach(async () => {
		await request(getUrl(vendor, readerEnv))
			.delete('/utils/cache/settings')
			.set('Authorization', adminAuth)
			.expect(200);

		await sharedRedis.del(readerEntryKey, flushEntryKey);
		flushRun = undefined;
		lastResponse = undefined;
	});

	// Awaited: the shard reuses the port range straight away, and an instance
	// still shutting down is still holding its port.
	afterAll(async () => {
		for (const spawnedInstance of spawnedInstances) {
			if (spawnedInstance.exitCode === null) {
				const instanceExited = new Promise((resolve) => {
					spawnedInstance.once('exit', resolve);
				});

				spawnedInstance.kill();
				await instanceExited;
			}
		}

		await sharedRedis.quit();
		await DeleteCollection(vendor, { collection: NOTE });
	});

	function readNote(nodeEnv: typeof readerEnv) {
		return request(getUrl(vendor, nodeEnv))
			.get(`/items/${NOTE}/${noteId}`)
			.query({ fields: ['id', 'label'] })
			.set('Authorization', adminAuth);
	}

	function defineScenarioSteps({ given, and, when, then }: StepFunctions) {
		given.optional('the reader serves no cached read', async () => {
			expect((await readNote(readerEnv)).headers[cacheStatusHeader])
				.toBe(undefined);
		});

		given.optional('no cache setting is stored', async () => {
			await request(getUrl(vendor, readerEnv))
				.delete('/utils/cache/settings')
				.set('Authorization', adminAuth)
				.expect(200);
		});

		// The route answers from the layer it just wrote, so the reader serves as
		// soon as it answers.
		when.optional('the reader switches the cache on', async () => {
			await request(getUrl(vendor, readerEnv))
				.patch('/utils/cache/settings')
				.send({ response: true })
				.set('Authorization', adminAuth)
				.expect(200);
		});

		// The MISS then HIT proves there is an entry for the steps after to find.
		and.optional('a label read through the reader is cached', async () => {
			expect((await readNote(readerEnv)).headers[cacheStatusHeader])
				.toBe('MISS');

			expect((await readNote(readerEnv)).headers[cacheStatusHeader])
				.toBe('HIT');
		});

		// The control: were it serving, it would have heard the switch, and its
		// write would be no lagging node's.
		and.optional('the lagging node serves no cached read', async () => {
			expect((await readNote(laggingEnv)).headers[cacheStatusHeader])
				.toBe(undefined);
		});

		when.optional(
			/^the label is changed to "(.*)" through the lagging node$/,
			async (newLabel: string) => {
				await request(getUrl(vendor, laggingEnv))
					.patch(`/items/${NOTE}/${noteId}`)
					.send({ label: newLabel })
					.set('Authorization', adminAuth)
					.expect(200);
			},
		);

		then.optional(
			/^the next label read through the reader is a "(HIT|MISS)" showing "(.*)"$/,
			async (cacheStatus: string, expectedLabel: string) => {
				const labelRead = await readNote(readerEnv);

				expect(labelRead.headers[cacheStatusHeader]).toBe(cacheStatus);

				expect(labelRead.body.data)
					.toEqual({ id: noteId, label: expectedLabel });
			},
		);

		and.optional(
			'the flush command\'s response cache holds an entry',
			async () => {
				await sharedRedis.set(flushEntryKey, 'before-flush');
			},
		);

		when.optional('`directus cache flush` runs', async () => {
			const flushEnv = cloneDeep(readerEnv);
			flushEnv[vendor]['CACHE_NAMESPACE'] = flushNamespace;
			flushEnv[vendor]['BUS_NAMESPACE'] = `${flushNamespace}:bus`;

			const flushProcess = spawn('node', [paths.cli, 'cache', 'flush'], {
				cwd: paths.cwd,
				env: flushEnv[vendor],
			});

			let flushOutput = '';

			flushProcess.stdout.on('data', (outputChunk) => {
				flushOutput += String(outputChunk);
			});

			flushProcess.stderr.on('data', (outputChunk) => {
				flushOutput += String(outputChunk);
			});

			// `close` waits for the output streams to drain, where `exit` can
			// land before the last log line does.
			const exitCode = await new Promise<number | null>((resolve, reject) => {
				const killTimer = setTimeout(() => {
					flushProcess.kill();
					reject(new Error(`directus cache flush hung:\n${flushOutput}`));
				}, 30_000);

				flushProcess.on('error', (spawnError) => {
					clearTimeout(killTimer);
					reject(spawnError);
				});

				flushProcess.on('close', (closeCode) => {
					clearTimeout(killTimer);
					resolve(closeCode);
				});
			});

			flushRun = { code: exitCode, output: flushOutput };
		});

		then.optional('it exits 0', () => {
			expect(flushRun!.code, flushRun!.output).toBe(0);
		});

		and.optional(
			'the flush command\'s response cache no longer holds that entry',
			async () => {
				expect(await sharedRedis.exists(flushEntryKey), flushRun!.output).toBe(0);
			},
		);

		and.optional('the reader\'s response cache holds an entry', async () => {
			await sharedRedis.set(readerEntryKey, 'before-switch');
		});

		when.optional(
			/^(an anonymous caller|an admin) sends PATCH \/settings (.*)$/,
			async (callerName: string, patchBody: string) => {
				const settingsPatch = request(getUrl(vendor, readerEnv))
					.patch('/settings')
					.send(JSON.parse(patchBody));

				if (callerName === 'an admin') {
					settingsPatch.set('Authorization', adminAuth);
				}

				lastResponse = await settingsPatch;
			},
		);

		then.optional(
			/^it answers (\d{3})(?: saying "(.*)")?$/,
			(expectedStatus: string, expectedReason: string | undefined) => {
				expect(lastResponse!.status, lastResponse!.text)
					.toBe(Number(expectedStatus));

				if (expectedReason !== undefined) {
					expect(lastResponse!.body.errors[0].message)
						.toContain(expectedReason);
				}
			},
		);

		and.optional(
			'the reader\'s response cache still holds that entry',
			async () => {
				expect(await sharedRedis.get(readerEntryKey)).toBe('before-switch');
			},
		);
	}

	defineFeature(feature, (scenario) => {
		scenario(
			'a write through a node that missed the switch purges the reader\'s entry',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'the flush command empties the response cache the setting switched on',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'the flush command empties the response cache with no setting stored',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'an anonymous switch-on clears nothing',
			defineScenarioSteps,
			60_000,
		);

		scenario(
			'a switch-on the guard refuses for its autoscale part clears nothing',
			defineScenarioSteps,
			60_000,
		);
	});
});
