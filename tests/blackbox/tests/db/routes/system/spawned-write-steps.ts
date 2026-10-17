import config, { getUrl, paths } from '@common/config';
import {
	cellOfKnownKeys,
	defineFeature,
	loadFeature,
	rememberedText,
} from '@common/cucumber';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { awaitDirectusConnection } from '@utils/await-connection';
import { stopSpawnedInstance } from '@utils/stop-spawned-instance';
import { type ChildProcess, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { freePortOfWorker } from '@utils/free-port-of-worker';
import { load as loadYaml } from 'js-yaml';
import { cloneDeep } from 'lodash-es';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

type RequestCell = {
	as?: string;
	method: 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST';
	path: string;
	query?: Record<string, string>;
	headers?: Record<string, string>;
	upload_metadata?: Record<string, string>;
	payload?: unknown;
	body?: string;
	remember?: string;
	remember_headers?: Record<string, string>;
};

type ResponseCell = {
	code?: number;
	body?: unknown;
	text?: string;
	headers?: Record<string, string>;
};

const REQUEST_CELL_KEYS = [
	'as',
	'method',
	'path',
	'query',
	'headers',
	'upload_metadata',
	'payload',
	'body',
	'remember',
	'remember_headers',
] as const satisfies readonly (keyof RequestCell)[];

const RESPONSE_CELL_KEYS = [
	'code',
	'body',
	'text',
	'headers',
] as const satisfies readonly (keyof ResponseCell)[];

type Row = { request: string; response: string };

type ScenarioKeys = {
	run: string;
	keysByName: Record<string, string>;
};

type SpawnedFeatureOptions = {
	envOverrides: Record<string, string>;
	beforeFeature?: (vendor: Vendor) => Promise<void>;
	afterFeature?: (vendor: Vendor) => Promise<void>;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

/**
 * Binds every scenario of a feature run against an instance of its own,
 * started with `envOverrides`: each holds an optional `Given these requests
 * are sent:` and a `Then these requests get these responses:`, both a
 * request|response table run row after row.
 */
export function defineSpawnedWriteFeature(
	featurePath: string,
	featureOptions: SpawnedFeatureOptions,
) {
	const feature = loadFeature(featurePath);

	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		let instance: ChildProcess;

		beforeAll(async () => {
			const port = await freePortOfWorker();
			env[vendor].PORT = String(port);
			env[vendor]['PUBLIC_URL'] = getUrl(vendor, env);
			Object.assign(env[vendor], featureOptions.envOverrides);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
			await featureOptions.beforeFeature?.(vendor);
		}, 60_000);

		afterAll(async () => {
			await stopSpawnedInstance(instance);
			await featureOptions.afterFeature?.(vendor);
		}, 60_000);

		defineFeature(feature, (scenario) => {
			for (const { title } of feature.scenarios) {
				scenario(title, ({ given, then }) => {
					const scenarioKeys: ScenarioKeys = {
						run: randomUUID(),
						keysByName: {},
					};

					given.optional('these requests are sent:', (table: Row[]) => {
						return sendRows(getUrl(vendor, env), scenarioKeys, table);
					});

					then('these requests get these responses:', (table: Row[]) => {
						return sendRows(getUrl(vendor, env), scenarioKeys, table);
					});
				}, 60_000);
			}
		});
	});
}

// `<run>` is unique to the scenario; a `<name>` met for the first time stands
// for a fresh uuid, or for the key a remembering row stored before.
function withKeys(cell: string, scenarioKeys: ScenarioKeys) {
	return cell.replaceAll(/<([\w-]+)>/g, (_placeholder, name: string) => {
		if (name === 'run') {
			return scenarioKeys.run;
		}

		scenarioKeys.keysByName[name] ??= randomUUID();

		return scenarioKeys.keysByName[name];
	});
}

// The tus header: each value base64, each pair a key and its value.
function uploadMetadataHeader(uploadMetadata: Record<string, string>) {
	return Object.entries(uploadMetadata)
		.map(([metadataKey, metadataValue]) => {
			return `${metadataKey} ${Buffer.from(metadataValue).toString('base64')}`;
		})
		.join(',');
}

function sendRequest(instanceUrl: string, requestCell: RequestCell) {
	const {
		as: token,
		method,
		path,
		query = {},
		headers = {},
		upload_metadata: uploadMetadata,
		payload,
		body,
	} = requestCell;

	const pendingRequest = {
		DELETE: () => request(instanceUrl).delete(path),
		GET: () => request(instanceUrl).get(path),
		HEAD: () => request(instanceUrl).head(path),
		PATCH: () => request(instanceUrl).patch(path),
		POST: () => request(instanceUrl).post(path),
	}[method]();

	const authorization = token === undefined
		? AUTH
		: `Bearer ${token}`;

	pendingRequest
		.query(query)
		.set(headers)
		.set('Authorization', authorization);

	if (uploadMetadata !== undefined) {
		pendingRequest.set('Upload-Metadata', uploadMetadataHeader(uploadMetadata));
	}

	if (body !== undefined) {
		return pendingRequest.send(Buffer.from(body));
	}

	return payload === undefined
		? pendingRequest
		: pendingRequest.send(payload as object);
}

// Only what the response cell states is compared: a header by its lowercase
// name, `text` against the raw body.
function receivedPart(response: Response, expectedResponse: ResponseCell) {
	return {
		code: response.statusCode,
		body: response.body,
		...(expectedResponse.text === undefined
			? {}
			: { text: response.text }),
		headers: response.headers,
	};
}

function lowercaseHeaders(expectedResponse: ResponseCell) {
	if (expectedResponse.headers === undefined) {
		return expectedResponse;
	}

	return {
		...expectedResponse,
		headers: Object.fromEntries(
			Object.entries(expectedResponse.headers).map(([name, value]) => {
				return [name.toLowerCase(), value];
			}),
		),
	};
}

// One row at a time, so a row can name the key one before it remembered. A
// remembered header keeps its last path segment: the upload a `Location`
// names, or the `Directus-File-Id` whole.
async function sendRows(
	instanceUrl: string,
	scenarioKeys: ScenarioKeys,
	table: Row[],
) {
	for (const { request: requestText, response: responseText } of table) {
		const requestCell = cellOfKnownKeys<RequestCell>(
			'request',
			loadYaml(withKeys(requestText, scenarioKeys)),
			REQUEST_CELL_KEYS,
			'spawned-write-steps.ts',
		);

		const expectedResponse = cellOfKnownKeys<ResponseCell>(
			'response',
			loadYaml(withKeys(responseText, scenarioKeys)) ?? {},
			RESPONSE_CELL_KEYS,
			'spawned-write-steps.ts',
		);

		const response = await sendRequest(instanceUrl, requestCell);

		expect(receivedPart(response, expectedResponse)).toMatchObject(
			lowercaseHeaders(expectedResponse),
		);

		if (requestCell.remember !== undefined) {
			scenarioKeys.keysByName[requestCell.remember] = rememberedText(
				requestCell.remember,
				response.body.data?.id,
			);
		}

		for (const [name, headerName] of Object.entries(
			requestCell.remember_headers ?? {},
		)) {
			scenarioKeys.keysByName[name] = rememberedText(
				name,
				response.headers[headerName.toLowerCase()],
			)
				.split('/')
				.at(-1)!;
		}
	}
}
