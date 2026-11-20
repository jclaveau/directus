import config, { getUrl, paths } from '@common/config';
import {
	cellOfKnownKeys,
	defineFeature,
	loadFeature,
	rememberedText,
	responseCellOf,
} from '@common/cucumber';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import {
	auditEnvForFeature,
	defineStatementCountsStep,
	warmUpAuditedInstance,
} from '@common/query-audit-steps';
import {
	bindCaptures,
	captureNamesOf,
	markedCaptures,
} from '@common/response-captures';
import { bindTableRowsSteps, insertTableRows } from '@common/table-rows';
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
import { yamlSchemaFor } from './singular-write-steps';

type RequestCell = {
	as?: string;
	on?: 'peer';
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
	headers?: Record<string, string | string[] | null>;
};

const REQUEST_CELL_KEYS = [
	'as',
	'on',
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

type InstanceUrls = {
	main: string;
	peer: string | null;
};

type ScenarioKeys = {
	run: string;
	keysByName: Record<string, string>;
};

type SpawnedFeatureOptions = {
	envOverrides: Record<string, string>;
	// A second instance on the same env, which a row reaches by `on: peer`.
	spawnsPeer?: boolean;
	beforeFeature?: (vendor: Vendor, instanceUrl: string) => Promise<void>;
	afterFeature?: (vendor: Vendor) => Promise<void>;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

/**
 * Binds every scenario of a feature run against an instance of its own,
 * started with `envOverrides`: each holds an optional `Given these requests
 * are sent:` or the rows of its tables, an optional `this read is cached:`,
 * and a `Then these requests get these responses:`, the request|response
 * tables run row after row. `beforeFeature` gets the instance's url, so a
 * collection it creates is in the schema the instance holds.
 */
export function defineSpawnedWriteFeature(
	featurePath: string,
	featureOptions: SpawnedFeatureOptions,
) {
	const feature = loadFeature(featurePath);

	describe.each(vendors)('%s', (vendor) => {
		const env = cloneDeep(config.envs);
		const peerEnv = cloneDeep(config.envs);
		let instance: ChildProcess;
		let peerInstance: ChildProcess | null = null;

		const instanceUrls = (): InstanceUrls => {
			return {
				main: getUrl(vendor, env),
				peer: peerInstance === null
					? null
					: getUrl(vendor, peerEnv),
			};
		};

		beforeAll(async () => {
			const port = await freePortOfWorker();
			env[vendor].PORT = String(port);
			env[vendor]['PUBLIC_URL'] = getUrl(vendor, env);

			Object.assign(
				env[vendor],
				featureOptions.envOverrides,
				auditEnvForFeature(feature, vendor),
			);

			instance = spawn('node', [paths.cli, 'start'], {
				cwd: paths.cwd,
				env: env[vendor],
			});

			await awaitDirectusConnection(port);
			await featureOptions.beforeFeature?.(vendor, getUrl(vendor, env));
			await warmUpAuditedInstance(feature, vendor, getUrl(vendor, env));

			// Started once the feature's collections exist, so it loads them.
			if (featureOptions.spawnsPeer) {
				const peerPort = await freePortOfWorker();

				peerEnv[vendor] = {
					...env[vendor],
					PORT: String(peerPort),
				};

				peerEnv[vendor]['PUBLIC_URL'] = getUrl(vendor, peerEnv);

				peerInstance = spawn('node', [paths.cli, 'start'], {
					cwd: paths.cwd,
					env: peerEnv[vendor],
				});

				await awaitDirectusConnection(peerPort);
			}
		}, 60_000);

		afterAll(async () => {
			await stopSpawnedInstance(instance);

			if (peerInstance !== null) {
				await stopSpawnedInstance(peerInstance);
			}

			await featureOptions.afterFeature?.(vendor);
		}, 60_000);

		defineFeature(feature, (scenario) => {
			for (const { title } of feature.scenarios) {
				scenario(title, ({ given, then, and }) => {
					const scenarioKeys: ScenarioKeys = {
						run: randomUUID(),
						keysByName: {},
					};

					const receivedResponses: Response[] = [];

					given.optional('these requests are sent:', async (table: Row[]) => {
						await sendRows(instanceUrls(), scenarioKeys, table, true, vendor);
					});

					bindTableRowsSteps(given, feature, title, (tableName, tableRows) => {
						return insertTableRows(vendor, tableName, tableRows.map((row) => {
							return Object.fromEntries(Object.entries(row).map(([column, cell]) => {
								return [column, withKeys(cell, scenarioKeys)];
							}));
						}));
					});

					// The first send fills the cache; the row's response is the second's.
					and.optional('this read is cached:', async (table: Row[]) => {
						await sendRows(
							instanceUrls(),
							scenarioKeys,
							table.map(({ request: requestText }) => {
								return { request: requestText, response: '' };
							}),
							true,
							vendor,
						);

						await sendRows(
							instanceUrls(),
							scenarioKeys,
							table,
							false,
							vendor,
						);
					});

					then('these requests get these responses:', async (table: Row[]) => {
						receivedResponses.push(...await sendRows(
							instanceUrls(),
							scenarioKeys,
							table,
							false,
							vendor,
						));
					});

					defineStatementCountsStep(and, vendor, receivedResponses);
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

function instanceUrlOf(instanceUrls: InstanceUrls, requestCell: RequestCell) {
	if (requestCell.on === undefined) {
		return instanceUrls.main;
	}

	if (requestCell.on !== 'peer' || instanceUrls.peer === null) {
		throw new Error(
			`A row sent on ${JSON.stringify(requestCell.on)} needs the feature`
			+ ' to start that instance: pass `spawnsPeer: true`',
		);
	}

	return instanceUrls.peer;
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
// name, `text` against the raw body. A header the response does not send
// reads as `null`, so a cell can state its absence.
function receivedPart(response: Response, expectedResponse: ResponseCell) {
	return {
		code: response.statusCode,
		body: response.body,
		...(expectedResponse.text === undefined
			? {}
			: { text: response.text }),
		headers: Object.fromEntries(
			Object.entries({
				...Object.fromEntries(
					Object.keys(lowercaseHeaders(expectedResponse).headers ?? {})
						.map((name) => {
							return [name, null];
						}),
				),
				...response.headers,
			}).map(([name, value]) => {
				return [
					name,
					Array.isArray(lowercaseHeaders(expectedResponse).headers?.[name])
						? String(value)
							.split(', ')
							.sort()
						: value,
				];
			}),
		),
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
				// A list states a comma-separated header in any order.
				return [
					name.toLowerCase(),
					Array.isArray(value)
						? [...value].sort()
						: value,
				];
			}),
		),
	};
}

// One row at a time, so a row can name the key one before it remembered or
// captured (see response-captures.ts). A remembered header keeps its last path
// segment: the upload a `Location` names, or the `Directus-File-Id` whole.
async function sendRows(
	instanceUrls: InstanceUrls,
	scenarioKeys: ScenarioKeys,
	table: Row[],
	allowsBlankResponse: boolean,
	vendor: Vendor,
) {
	const responses: Response[] = [];

	const responseCellFrom = (responseText: string) => {
		const responseCell = loadYaml(withKeys(responseText, scenarioKeys));

		return responseCellOf<ResponseCell>(
			allowsBlankResponse
				? responseCell ?? {}
				: responseCell,
			RESPONSE_CELL_KEYS,
			'spawned-write-steps.ts',
		);
	};

	for (const { request: requestText, response: responseText } of table) {
		const requestCell = cellOfKnownKeys<RequestCell>(
			'request',
			loadYaml(withKeys(requestText, scenarioKeys), {
				schema: yamlSchemaFor(vendor),
			}),
			REQUEST_CELL_KEYS,
			'spawned-write-steps.ts',
		);

		const captureNames = captureNamesOf(
			responseText,
			scenarioKeys.keysByName,
		);

		const markedResponse = responseCellFrom(
			markedCaptures(responseText, captureNames),
		);

		const response = await sendRequest(
			instanceUrlOf(instanceUrls, requestCell),
			requestCell,
		);

		responses.push(response);

		bindCaptures(
			lowercaseHeaders(markedResponse),
			receivedPart(response, markedResponse),
			scenarioKeys.keysByName,
			captureNames,
		);

		const expectedResponse = responseCellFrom(responseText);

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

	return responses;
}
