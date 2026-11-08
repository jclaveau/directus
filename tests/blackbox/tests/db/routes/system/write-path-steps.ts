import {
	cellOfKnownKeys,
	defineFeature,
	loadFeature,
	rememberedText,
	responseCellOf,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import {
	defineStatementCountsStep,
	instanceUrlForFeature,
} from '@common/query-audit-steps';
import { createWebSocketConn } from '@common/transport';
import { USER } from '@common/variables';
import { randomUUID } from 'crypto';
import { load as loadYaml } from 'js-yaml';
import request, { type Response } from 'supertest';
import { describe, expect } from 'vitest';

type AttachedFile = { name: string; content: string };

type HttpCell = {
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST';
	path: string;
	query?: Record<string, string>;
	payload?: unknown;
	file?: AttachedFile | AttachedFile[];
};

type WebSocketCell = {
	websocket: Record<string, unknown>;
};

type RequestCell = (HttpCell | WebSocketCell) & {
	remember?: string | Record<string, string>;
	eventually?: boolean;
	retry_stale_hash?: string;
};

const REQUEST_CELL_KEYS = [
	'method',
	'path',
	'query',
	'payload',
	'file',
	'websocket',
	'remember',
	'eventually',
	'retry_stale_hash',
] as const satisfies readonly (
	keyof HttpCell | keyof WebSocketCell | keyof RequestCell
)[];

// An HTTP answer, or the reply a `websocket:` message got.
const RESPONSE_CELL_KEYS = ['code', 'body', 'reply'] as const;

type Row = { request: string; response: string };

type ScenarioKeys = {
	run: string;
	keysByName: Record<string, string>;
};

type RememberingRow = { requestText: string; dottedPath: string };

const STALE_HASH_ATTEMPTS = 3;

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

/**
 * Binds every scenario of a write-path feature: each holds an optional
 * `Given these requests are sent:` and a `Then these requests get these
 * responses:`, both a request|response table run row after row. A request is
 * an HTTP call, or a `websocket:` message whose reply is the response.
 */
export function defineWritePathFeature(featurePath: string) {
	const feature = loadFeature(featurePath);

	describe.each(vendors)('%s', (vendor) => {
		const instanceUrl = instanceUrlForFeature(feature, vendor);

		defineFeature(feature, (scenario) => {
			for (const { title } of feature.scenarios) {
				scenario(title, ({ given, then, and }) => {
					const scenarioKeys: ScenarioKeys = {
						run: randomUUID(),
						keysByName: {},
					};

					const receivedResponses: (Response | undefined)[] = [];

					given.optional('these requests are sent:', async (table: Row[]) => {
						await sendRows(instanceUrl(), scenarioKeys, table, true);
					});

					then('these requests get these responses:', async (table: Row[]) => {
						receivedResponses.push(...await sendRows(
							instanceUrl(),
							scenarioKeys,
							table,
							false,
						));
					});

					defineStatementCountsStep(and, vendor, receivedResponses);
				}, 60_000);
			}
		});
	});
}

// `<run>` is unique to the scenario; a `<name>` met for the first time stands
// for a fresh uuid, or for the value a `remember` row stored before.
function withKeys(cell: string, scenarioKeys: ScenarioKeys) {
	return cell.replaceAll(/<([\w-]+)>/g, (_placeholder, name: string) => {
		if (name === 'run') {
			return scenarioKeys.run;
		}

		scenarioKeys.keysByName[name] ??= randomUUID();

		return scenarioKeys.keysByName[name];
	});
}

function sendHttpRequest(instanceUrl: string, requestCell: HttpCell) {
	const { method, path, query = {}, payload, file } = requestCell;

	const pendingRequest = {
		DELETE: () => request(instanceUrl).delete(path),
		GET: () => request(instanceUrl).get(path),
		PATCH: () => request(instanceUrl).patch(path),
		POST: () => request(instanceUrl).post(path),
	}[method]();

	pendingRequest.query(query).set('Authorization', AUTH);

	if (file !== undefined) {
		for (const attachedFile of [file].flat()) {
			pendingRequest.attach(
				'file',
				Buffer.from(attachedFile.content),
				attachedFile.name,
			);
		}

		return pendingRequest;
	}

	return payload === undefined
		? pendingRequest
		: pendingRequest.send(payload as object);
}

// One socket per message: the reply carrying the message's uid is the answer.
async function sendWebSocketMessage(
	instanceUrl: string,
	requestCell: WebSocketCell,
) {
	const socket = createWebSocketConn(instanceUrl, {
		auth: { access_token: USER.ADMIN.TOKEN },
	});

	const messageUid = randomUUID();

	try {
		await socket.sendMessage({
			type: 'items',
			uid: messageUid,
			...requestCell.websocket,
		});

		const [reply] = await socket.getMessages(1, { uid: messageUid });

		return reply as unknown;
	}
	finally {
		socket.conn.close();
	}
}

// An HTTP call's response is also logged, for the statements it ran.
async function answerOf(
	instanceUrl: string,
	requestCell: RequestCell,
	responseLog: Response[],
) {
	if ('websocket' in requestCell) {
		return { reply: await sendWebSocketMessage(instanceUrl, requestCell) };
	}

	const response: Response = await sendHttpRequest(instanceUrl, requestCell);
	responseLog.push(response);

	return { code: response.statusCode, body: response.body as unknown };
}

function valueAtPath(answer: unknown, dottedPath: string) {
	return dottedPath.split('.').reduce<unknown>((value, segment) => {
		return (value as Record<string, unknown>)[segment];
	}, answer);
}

// `remember: name` keeps `body.data.id`; a mapping keeps each named path.
function rememberedPaths(remember: RequestCell['remember']) {
	if (typeof remember === 'string') {
		return { [remember]: 'body.data.id' };
	}

	return remember ?? {};
}

// One row at a time, so a row can name a value one before it remembered. A
// response cell states the keys it checks; an array still has to hold as many
// items as it states. Returns each row's last HTTP response, none for a
// `websocket:` row.
async function sendRows(
	instanceUrl: string,
	scenarioKeys: ScenarioKeys,
	table: Row[],
	allowsBlankResponse: boolean,
) {
	const rememberingRows: Record<string, RememberingRow> = {};
	const rowResponses: (Response | undefined)[] = [];

	for (const { request: requestText, response: responseText } of table) {
		const responseLog: Response[] = [];

		const requestCell = cellOfKnownKeys<RequestCell>(
			'request',
			loadYaml(withKeys(requestText, scenarioKeys)),
			REQUEST_CELL_KEYS,
			'write-path-steps.ts',
		);

		const expectedAnswer = responseCellOf<object>(
			allowsBlankResponse
				? loadYaml(withKeys(responseText, scenarioKeys)) ?? {}
				: loadYaml(withKeys(responseText, scenarioKeys)),
			RESPONSE_CELL_KEYS,
			'write-path-steps.ts',
		);

		let answer: unknown;

		if (requestCell.retry_stale_hash !== undefined) {
			answer = await answerRetakingHash(
				instanceUrl,
				responseLog,
				scenarioKeys,
				requestText,
				requestCell.retry_stale_hash,
				rememberingRows[requestCell.retry_stale_hash]!,
			);

			expect(answer).toMatchObject(expectedAnswer);
		}
		else if (requestCell.eventually) {
			await expect.poll(async () => {
				answer = await answerOf(instanceUrl, requestCell, responseLog);

				return answer;
			}, { timeout: 10_000, interval: 250 }).toMatchObject(
				expectedAnswer,
			);
		}
		else {
			answer = await answerOf(instanceUrl, requestCell, responseLog);

			expect(answer).toMatchObject(expectedAnswer);
		}

		for (const [name, dottedPath] of Object.entries(
			rememberedPaths(requestCell.remember),
		)) {
			scenarioKeys.keysByName[name] = rememberedText(
				name,
				valueAtPath(answer, dottedPath),
			);

			rememberingRows[name] = { requestText, dottedPath };
		}

		rowResponses.push(responseLog.at(-1));
	}

	return rowResponses;
}

function isStaleHashRefusal(answer: unknown) {
	const { code, body } = answer as {
		code?: number;
		body?: { errors?: { message?: string }[] };
	};

	return code === 400
		&& body?.errors?.[0]?.message?.startsWith(
			'Invalid payload. Provided hash does not match',
		) === true;
}

// A diff applies only under the hash it was taken from, and files in the
// parallel middle move the schema too: on a stale-hash refusal the row takes
// the hash again from the row that remembered it, then re-sends, as a client
// of /schema/apply would. The row's response is its last attempt's, so a
// statement count names only that attempt's statements.
// TODO(#617): hold a harness lock around every schema-moving file instead.
async function answerRetakingHash(
	instanceUrl: string,
	responseLog: Response[],
	scenarioKeys: ScenarioKeys,
	requestText: string,
	hashName: string,
	hashRow: RememberingRow,
) {
	const sendRow = (rowText: string) => {
		return answerOf(
			instanceUrl,
			loadYaml(withKeys(rowText, scenarioKeys)) as RequestCell,
			responseLog,
		);
	};

	let answer: unknown = await sendRow(requestText);

	for (
		let attempt = 1;
		attempt < STALE_HASH_ATTEMPTS && isStaleHashRefusal(answer);
		attempt++
	) {
		scenarioKeys.keysByName[hashName] = rememberedText(
			hashName,
			valueAtPath(await sendRow(hashRow.requestText), hashRow.dottedPath),
		);

		answer = await sendRow(requestText);
	}

	return answer;
}
