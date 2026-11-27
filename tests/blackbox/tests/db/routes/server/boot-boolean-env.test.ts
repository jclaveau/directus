import config, { paths, type Env } from '@common/config';
import {
	defineFeature,
	loadFeature,
	messageOfDocString,
	responseCellOf,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { stopSpawnedInstance } from '@utils/stop-spawned-instance';
import axios from 'axios';
import { type ChildProcess, spawn } from 'child_process';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, afterEach, describe, expect } from 'vitest';

const feature = loadFeature('./tests/db/routes/server/boot-boolean-env.feature');

const STEP_LIBRARY = 'boot-boolean-env.test.ts';

const PROCESS_ENV_STEP = /^the process env sets (\w+) to (".*")$/;

const CONFIG_FILE_STEP = /^the config file sets (\w+) to (".*")$/;

const SECRET_FILE_STEP = /^the secret file of (\w+) holds (".*")$/;

const EXIT_WITHOUT_PING_STEP
	= /^the instance exits with code (\d+), never having answered \/server\/ping$/;

type RequestCell = {
	method: 'POST';
	path: string;
	payload: unknown;
};

type ResponseCell = {
	code: number;
	body: unknown;
};

describe.each(vendors)('%s', (vendor) => {
	let env: Env;
	let instance: ChildProcess | undefined;
	let instanceStderr: string[] = [];
	let secretDir: string | undefined;

	async function writeTempFile(fileName: string, content: string) {
		secretDir ??= await mkdtemp(join(tmpdir(), 'boot-boolean-env-'));
		const filePath = join(secretDir, fileName);
		await writeFile(filePath, content);
		return filePath;
	}

	function instanceUrl() {
		return `http://127.0.0.1:${env[vendor].PORT}`;
	}

	afterEach(async () => {
		await stopSpawnedInstance(instance);
		instance = undefined;
	});

	afterAll(async () => {
		if (secretDir !== undefined) {
			await rm(secretDir, { recursive: true, force: true });
		}
	});

	const startInstance = async () => {
		env[vendor].PORT = String(await freePortOfWorker());
		instanceStderr = [];

		const spawned = spawn('node', [paths.cli, 'start'], {
			cwd: paths.cwd,
			env: env[vendor],
		});

		spawned.stderr?.on('data', (chunk) => instanceStderr.push(String(chunk)));
		instance = spawned;
	};

	// Polled while the instance runs: the refusal is thrown at import, so a ping
	// that answers means the boot got past it and listened.
	const awaitExitWithoutPing = async (exitCode: string) => {
		const spawned = instance as ChildProcess;
		let answeredPing = false;

		while (spawned.exitCode === null) {
			try {
				await axios.get(`${instanceUrl()}/server/ping`);
				answeredPing = true;
				break;
			}
			catch {
				await new Promise((resolve) => setTimeout(resolve, 250));
			}
		}

		expect(answeredPing).toBe(false);
		expect(spawned.exitCode).toBe(Number(exitCode));
	};

	// Node prints an error thrown at import as `Error: <message>`, one line.
	const expectStderrError = (docString: string) => {
		expect(instanceStderr.join('').split('\n')).toContain(
			`Error: ${messageOfDocString(docString)}`,
		);
	};

	const givenProcessEnv = (key: string, quotedValue: string) => {
		env = cloneDeep(config.envs);
		env[vendor][key] = JSON.parse(quotedValue);
	};

	const givenConfigFile = async (key: string, quotedValue: string) => {
		env = cloneDeep(config.envs);

		env[vendor]['CONFIG_PATH'] = await writeTempFile(
			'config.json',
			JSON.stringify({ [key]: JSON.parse(quotedValue) }),
		);
	};

	const givenSecretFile = async (key: string, quotedContent: string) => {
		env = cloneDeep(config.envs);
		// The base env sets CACHE_ENABLED; beside its _FILE that refuses the boot
		delete env[vendor][key.slice(0, -'_FILE'.length)];
		env[vendor][key] = await writeTempFile(key, JSON.parse(quotedContent));
	};

	const refusedBoots = [
		{
			title: 'yes in the process env ends the boot',
			givenMatcher: PROCESS_ENV_STEP,
			givenStep: givenProcessEnv,
		},
		{
			title: 'yes in the config file ends the boot',
			givenMatcher: CONFIG_FILE_STEP,
			givenStep: givenConfigFile,
		},
		{
			title: 'yes in a _FILE secret ends the boot',
			givenMatcher: SECRET_FILE_STEP,
			givenStep: givenSecretFile,
		},
		{
			title: 'an empty value in the process env ends the boot',
			givenMatcher: PROCESS_ENV_STEP,
			givenStep: givenProcessEnv,
		},
	];

	defineFeature(feature, (scenario) => {
		for (const { title, givenMatcher, givenStep } of refusedBoots) {
			scenario(title, ({ given, when, then, and }) => {
				given(givenMatcher, givenStep);
				when('an instance starts', startInstance);
				then(EXIT_WITHOUT_PING_STEP, awaitExitWithoutPing);
				and('its stderr holds this error:', expectStderrError);
			}, 60_000);
		}

		const introspectionBoots = [
			{
				title: 'true and a newline in a _FILE secret reads as true',
				givenMatcher: SECRET_FILE_STEP,
				givenStep: givenSecretFile,
			},
			{
				title: 'TRUE in the process env reads as true',
				givenMatcher: PROCESS_ENV_STEP,
				givenStep: givenProcessEnv,
			},
		];

		for (const { title, givenMatcher, givenStep } of introspectionBoots) {
			scenario(title, ({ given, when, then, and }) => {
				given(givenMatcher, givenStep);

				when('an instance starts', startInstance);

				then('the instance answers /server/ping', async () => {
					await awaitDirectusConnection(Number(env[vendor].PORT));
				});

				and(
					'these requests get these responses:',
					async (table: { request: string; response: string }[]) => {
						for (const row of table) {
							const requestCell = loadYaml(row.request) as RequestCell;

							const response = await request(instanceUrl())[
								requestCell.method.toLowerCase() as 'post'
							](requestCell.path)
								.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`)
								.send(requestCell.payload as object);

							expect({
								code: response.status,
								body: response.body,
							}).toMatchObject(responseCellOf<ResponseCell>(
								loadYaml(row.response),
								['code', 'body'],
								STEP_LIBRARY,
							));
						}
					},
				);
			}, 60_000);
		}
	});
});
