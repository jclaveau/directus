import { getUrl } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { bindTableRowsSteps, insertTableRows } from '@common/table-rows';
import { USER } from '@common/variables';
import { randomUUID } from 'crypto';
import { load as loadYaml } from 'js-yaml';
import request from 'supertest';
import { afterEach, describe, expect } from 'vitest';
import { WebSocket } from 'ws';
import {
	type ScenarioKeys,
	withKeys,
} from '../routes/system/spawned-write-steps';
import { collectionReinit } from './graphql-second-init.seed';

type Frame = Record<string, unknown>;
type FrameRow = { sent: string; received: string };

type SentRequest = {
	method: string;
	path: string;
	payload: object;
};

const EXCHANGE_STEP = 'the socket exchanges these frames:';
const HEARING_STEP = 'the subscription hears a note created as the admin';
const HEARING_ATTEMPTS = 20;
const FRAME_WAIT_MS = 20_000;

const feature = loadFeature('./tests/db/websocket/graphql-second-init.feature');

describe.each(vendors)('%s', (vendor) => {
	let openSocket: WebSocket | undefined;

	afterEach(() => {
		openSocket?.terminate();
		openSocket = undefined;
	});

	defineFeature(feature, (scenario) => {
		for (const { title, steps } of feature.scenarios) {
			scenario(title, ({ given, then }) => {
				const scenarioKeys: ScenarioKeys = {
					run: randomUUID(),
					keysByName: {},
				};

				const receivedFrames: Frame[] = [];

				bindTableRowsSteps(given, feature, title, (tableName, tableRows) => {
					return insertTableRows(vendor, tableName, tableRows.map((row) => {
						return Object.fromEntries(Object.entries(row)
							.map(([column, cell]) => {
								return [column, withKeys(cell, scenarioKeys)];
							}));
					}));
				});

				const socketOfScenario = async () => {
					if (openSocket === undefined) {
						const graphqlUrl = `${getUrl(vendor).replace(/^http/, 'ws')}/graphql`;
						openSocket = new WebSocket(graphqlUrl, 'graphql-transport-ws');

						openSocket.on('message', (data) => {
							receivedFrames.push(JSON.parse(data.toString()));
						});

						openSocket.on('close', (code, reason) => {
							receivedFrames.push({ close: code, reason: reason.toString() });
						});

						await new Promise((resolve, reject) => {
							openSocket!.once('open', resolve);
							openSocket!.once('error', reject);
						});
					}

					return openSocket;
				};

				const sendAsAdmin = async (sentRequest: SentRequest) => {
					if (sentRequest.method !== 'POST') {
						throw new Error(
							`The sent request's method ${JSON.stringify(sentRequest.method)}`
							+ ' is not POST',
						);
					}

					const response = await request(getUrl(vendor))
						.post(sentRequest.path)
						.send(sentRequest.payload)
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					expect(response.statusCode).toEqual(200);
				};

				// Every frame a row expects, or the close, ends the wait.
				const framesFrom = async (startIndex: number, frameCount: number) => {
					const deadlineMs = Date.now() + FRAME_WAIT_MS;

					while (
						receivedFrames.length - startIndex < frameCount
						&& openSocket?.readyState !== WebSocket.CLOSED
						&& Date.now() < deadlineMs
					) {
						await new Promise((resolve) => setTimeout(resolve, 10));
					}

					return receivedFrames.slice(startIndex);
				};

				const exchangeFrames = async (table: FrameRow[]) => {
					for (const { sent, received } of table) {
						const sentCell = loadYaml(withKeys(sent, scenarioKeys)) as Frame;

						const expectedFrames = loadYaml(
							withKeys(received, scenarioKeys),
						) as Frame[];

						const startIndex = receivedFrames.length;

						if ('request' in sentCell) {
							await sendAsAdmin(sentCell['request'] as SentRequest);
						}
						else {
							(await socketOfScenario()).send(JSON.stringify(sentCell));
						}

						expect(await framesFrom(startIndex, expectedFrames.length))
							.toEqual(expectedFrames);
					}
				};

				// A subscription answers nothing once registered, so notes are
				// created until one reaches it; the frames they bring are not
				// part of any row.
				const hearNote = async () => {
					for (let attempt = 1; attempt <= HEARING_ATTEMPTS; attempt++) {
						const label = `early-${attempt}-${scenarioKeys.run}`;
						const startIndex = receivedFrames.length;

						await sendAsAdmin({
							method: 'POST',
							path: `/items/${collectionReinit}`,
							payload: { label },
						});

						const heardDeadlineMs = Date.now() + 1000;

						while (Date.now() < heardDeadlineMs) {
							const heardFrames = receivedFrames.slice(startIndex);

							if (JSON.stringify(heardFrames).includes(label)) {
								return;
							}

							await new Promise((resolve) => setTimeout(resolve, 10));
						}
					}

					throw new Error(
						`The subscription heard none of the ${HEARING_ATTEMPTS} notes`
						+ ' created as the admin',
					);
				};

				for (const { stepText } of steps) {
					if (stepText === EXCHANGE_STEP) {
						then(EXCHANGE_STEP, exchangeFrames);
					}
					else if (stepText === HEARING_STEP) {
						then(HEARING_STEP, hearNote);
					}
					else if (!stepText.startsWith('the rows of ')) {
						throw new Error(`No step binds ${JSON.stringify(stepText)}`);
					}
				}
			}, 60_000);
		}
	});
});
