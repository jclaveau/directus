import { getUrl } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { createWebSocketConn } from '@common/transport';
import { USER } from '@common/variables';
import { randomUUID } from 'crypto';
import { load as loadYaml } from 'js-yaml';
import request, { type Response } from 'supertest';
import { describe, expect } from 'vitest';

type HttpCell = {
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST';
	path: string;
	query?: Record<string, string>;
	payload?: unknown;
	file?: { name: string; content: string };
};

type WebSocketCell = {
	websocket: Record<string, unknown>;
};

type RequestCell = (HttpCell | WebSocketCell) & {
	remember?: string | Record<string, string>;
	eventually?: boolean;
};

type Row = { request: string; response: string };

type ScenarioKeys = {
	run: string;
	keysByName: Record<string, string>;
};

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
		defineFeature(feature, (scenario) => {
			for (const { title } of feature.scenarios) {
				scenario(title, ({ given, then }) => {
					const scenarioKeys: ScenarioKeys = {
						run: randomUUID(),
						keysByName: {},
					};

					given.optional('these requests are sent:', (table: Row[]) => {
						return sendRows(vendor, scenarioKeys, table);
					});

					then('these requests get these responses:', (table: Row[]) => {
						return sendRows(vendor, scenarioKeys, table);
					});
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

function sendHttpRequest(vendor: Vendor, requestCell: HttpCell) {
	const { method, path, query = {}, payload, file } = requestCell;

	const pendingRequest = {
		DELETE: () => request(getUrl(vendor)).delete(path),
		GET: () => request(getUrl(vendor)).get(path),
		PATCH: () => request(getUrl(vendor)).patch(path),
		POST: () => request(getUrl(vendor)).post(path),
	}[method]();

	pendingRequest.query(query).set('Authorization', AUTH);

	if (file !== undefined) {
		return pendingRequest.attach(
			'file',
			Buffer.from(file.content),
			file.name,
		);
	}

	return payload === undefined
		? pendingRequest
		: pendingRequest.send(payload as object);
}

// One socket per message: the reply carrying the message's uid is the answer.
async function sendWebSocketMessage(vendor: Vendor, requestCell: WebSocketCell) {
	const socket = createWebSocketConn(getUrl(vendor), {
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

async function answerOf(vendor: Vendor, requestCell: RequestCell) {
	if ('websocket' in requestCell) {
		return { reply: await sendWebSocketMessage(vendor, requestCell) };
	}

	const response: Response = await sendHttpRequest(vendor, requestCell);

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
// items as it states.
async function sendRows(
	vendor: Vendor,
	scenarioKeys: ScenarioKeys,
	table: Row[],
) {
	for (const { request: requestText, response: responseText } of table) {
		const requestCell = loadYaml(
			withKeys(requestText, scenarioKeys),
		) as RequestCell;

		const expectedAnswer = loadYaml(
			withKeys(responseText, scenarioKeys),
		) ?? {};

		let answer: unknown;

		if (requestCell.eventually) {
			await expect.poll(async () => {
				answer = await answerOf(vendor, requestCell);

				return answer;
			}, { timeout: 10_000, interval: 250 }).toMatchObject(
				expectedAnswer,
			);
		}
		else {
			answer = await answerOf(vendor, requestCell);

			expect(answer).toMatchObject(expectedAnswer);
		}

		for (const [name, dottedPath] of Object.entries(
			rememberedPaths(requestCell.remember),
		)) {
			scenarioKeys.keysByName[name] = String(
				valueAtPath(answer, dottedPath),
			);
		}
	}
}
