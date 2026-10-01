import config, { getUrl, paths } from '@common/config';
import {
	defineFeature,
	loadFeature,
	type StepFunctions,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { ChildProcess, spawn } from 'child_process';
import { once } from 'node:events';
import getPort from 'get-port';
import Redis from 'ioredis';
import { cloneDeep } from 'lodash-es';
import request from 'supertest';
import { afterEach, describe, expect } from 'vitest';
import {
	type Rig,
	poolSize,
	startAutoscaler,
	startPool,
	stopRig,
} from './autoscale/rig';

const feature = loadFeature(
	'./tests/db/app/autoscale-pool-health-refresh.feature',
);

const auth = `Bearer ${USER.ADMIN.TOKEN}`;

// Each scenario builds its own rig, so a pool, an autoscaler and a Directus boot.
const scenarioTimeout = 240_000;

describe.each(vendors)('%s', (vendor) => {
	let rig: Rig | null = null;
	let directus: ChildProcess | null = null;
	let listener: Redis | null = null;
	let admin: Redis | null = null;
	let directusUrl = '';
	let namespace = '';
	let refresh = '';
	let heard: { channel: string; message: string; at: number }[] = [];

	afterEach(() => {
		if (rig !== null) {
			stopRig(rig);
		}

		directus?.kill();
		listener?.disconnect();
		admin?.disconnect();
		rig = null;
		directus = null;
		listener = null;
		admin = null;
		heard = [];
	});

	/** Polls `/server/health` until `done` holds of its body, or `timeoutMs`. */
	async function healthUntil(
		done: (body: Record<string, any>) => boolean,
		timeoutMs = 120_000,
	) {
		const deadline = Date.now() + timeoutMs;

		const askHealth = () => {
			return request(directusUrl)
				.get('/server/health')
				.set('Authorization', auth);
		};

		let response = await askHealth();

		while (done(response.body) === false && Date.now() < deadline) {
			await new Promise((resolve) => setTimeout(resolve, 500));
			response = await askHealth();
		}

		return response;
	}

	function heardSince(since: number, name: string) {
		return heard.filter(({ channel, at }) => {
			return at >= since && channel === `${namespace}:bus:${name}`;
		});
	}

	async function givenPool(refreshGiven: string) {
		refresh = refreshGiven;

		namespace = `blackbox-pool-health-refresh-${vendor}-${Date.now()}`;

		listener = new Redis({ host: 'localhost', port: 6108 });

		listener.on('message', (channel: string, message: string) => {
			heard.push({ channel, message, at: Date.now() });
		});

		await listener.subscribe(
			`${namespace}:bus:poolHealth`,
			`${namespace}:bus:poolHealth:query`,
		);

		rig = startPool({
			appName: `pool-health-refresh-${vendor}`,
			instances: 2,
			crashAfterMs: 2000,
			crashOnlyInstance: '1',
			giveUpAfterRestarts: 1,
		});

		expect(await poolSize(rig, 1, 60_000)).toBe(1);

		startAutoscaler(rig, {
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
			CACHE_NAMESPACE: namespace,
			PM2_AUTOSCALE_ENABLED: 'false',
			...refresh === ''
				? {}
				: { PM2_POOL_HEALTH_REFRESH: refresh },
		});
	}

	function defineGivenPool({ given }: StepFunctions) {
		given(
			/^a pool short of one worker, reported with (?:the default refresh|a refresh of (\w+))$/,
			async (refreshGiven: string | undefined) => {
				await givenPool(refreshGiven ?? '');
			},
		);
	}

	function defineDirectusWarns({ and }: StepFunctions) {
		and('a Directus on its bus warning about the pool', async () => {
			const env = cloneDeep(config.envs)[vendor]!;
			const port = await getPort();

			env['PORT'] = String(port);
			env['REDIS_HOST'] = 'localhost';
			env['REDIS_PORT'] = '6108';
			env['CACHE_NAMESPACE'] = namespace;
			// What finds this instance's connections in `CLIENT LIST`.
			env['REDIS_CONNECTION_NAME'] = namespace;

			if (refresh !== '') {
				env['PM2_POOL_HEALTH_REFRESH'] = refresh;
			}

			directus = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env,
			});

			await awaitDirectusConnection(port);

			directusUrl = getUrl(vendor, { [vendor]: env } as never);

			const { body } = await healthUntil((health) => {
				return health['checks']?.['processes:pool'] !== undefined;
			});

			expect(body['checks']?.['processes:pool']?.[0]?.status).toBe('warn');
		});
	}

	defineFeature(feature, (test) => {
		test(
			'a Directus whose bus reconnected asks for the reading again',
			(steps) => {
				const { when, then, and } = steps;
				let droppedAt = 0;

				defineGivenPool(steps);
				defineDirectusWarns(steps);

				when('the bus carries a reading of a full pool', async () => {
					admin = new Redis({ host: 'localhost', port: 6108 });

					// What the bus sends a message under this size as: its JSON.
					await admin.publish(
						`${namespace}:bus:poolHealth`,
						JSON.stringify({
							failedWorkers: 0,
							onlineWorkers: 1,
							targetWorkers: 1,
						}),
					);
				});

				then('the Directus no longer warns about the pool', async () => {
					const { body } = await healthUntil((health) => {
						return health['checks']?.['processes:pool'] === undefined;
					}, 30_000);

					expect(body['checks']?.['processes:pool']).toBeUndefined();
				});

				when('Redis drops every connection of that Directus', async () => {
					const clients = String(await admin!.client('LIST'))
						.split('\n')
						.filter((line) => line.includes(` name=${namespace} `));

					expect(clients.length).toBeGreaterThan(0);

					droppedAt = Date.now();

					for (const client of clients) {
						const clientId = client.match(/^id=(\d+) /)![1]!;

						await admin!.client('KILL', 'ID', clientId);
					}
				});

				then(/^the Directus asks for the reading on "(.+)"$/, async (
					channelName: string,
				) => {
					const deadline = Date.now() + 30_000;

					while (
						heardSince(droppedAt, channelName).length === 0
						&& Date.now() < deadline
					) {
						await new Promise((resolve) => setTimeout(resolve, 250));
					}

					expect(heardSince(droppedAt, channelName)).toHaveLength(1);
				});

				and('the Directus warns about the pool again', async () => {
					const { body } = await healthUntil((health) => {
						return health['checks']?.['processes:pool'] !== undefined;
					}, 30_000);

					expect(body['checks']?.['processes:pool']?.[0]).toMatchObject({
						status: 'warn',
						observedValue: 1,
					});
				});
			},
			scenarioTimeout,
		);

		test(
			'an unchanged reading is sent again once a refresh went by',
			(steps) => {
				const { when, then } = steps;
				let listenedFrom = 0;

				defineGivenPool(steps);

				when(/^the bus is listened to for (\d+) seconds$/, async (
					seconds: string,
				) => {
					listenedFrom = Date.now();

					await new Promise((resolve) => {
						setTimeout(resolve, Number(seconds) * 1000);
					});
				});

				then(
					/^the reading is heard at least (\d+) times, (\d+) to (\d+) seconds apart$/,
					(times: string, fewestSeconds: string, mostSeconds: string) => {
						const sentAt = heardSince(listenedFrom, 'poolHealth')
							.map(({ at }) => at);

						expect(sentAt.length).toBeGreaterThanOrEqual(Number(times));

						for (const [index, at] of sentAt.slice(1).entries()) {
							const gap = at - sentAt[index]!;

							// Heard a hop after it was sent, hence half a second of slack.
							expect(gap).toBeGreaterThanOrEqual(
								Number(fewestSeconds) * 1000 - 500,
							);

							expect(gap).toBeLessThanOrEqual(Number(mostSeconds) * 1000);
						}
					},
				);
			},
			scenarioTimeout,
		);

		test(
			'a reading its killed reporter never took back expires after two refreshes',
			(steps) => {
				const { when, then, and } = steps;
				let killedAt = 0;

				defineGivenPool(steps);
				defineDirectusWarns(steps);

				when(
					'the autoscaler is killed without a chance to take its reading back',
					async () => {
						const autoscaler = rig!.autoscaler!;

						killedAt = Date.now();
						autoscaler.kill('SIGKILL');
						await once(autoscaler, 'exit');
					},
				);

				then(
					/^the Directus stops warning about the pool within (\d+) seconds$/,
					async (seconds: string) => {
						const { body } = await healthUntil((health) => {
							return health['checks']?.['processes:pool'] === undefined;
						}, Number(seconds) * 1000);

						expect(body['checks']?.['processes:pool']).toBeUndefined();
					},
				);

				and(/^nothing was sent on "(.+)" after the kill$/, (
					channelName: string,
				) => {
					expect(heardSince(killedAt, channelName)).toEqual([]);
				});
			},
			scenarioTimeout,
		);
	});
});
