import { getUrl } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors, { type Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { randomUUID } from 'crypto';
import { load as loadYaml } from 'js-yaml';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect } from 'vitest';

type RequestCell = {
	as?: string;
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST';
	path: string;
	query?: Record<string, string>;
	payload?: unknown;
	remember?: string;
	eventually?: boolean;
};

type Row = { request: string; response: string };

type ScenarioKeys = {
	run: string;
	keysByName: Record<string, string>;
};

type FeatureHooks = {
	beforeFeature?: (vendor: Vendor) => Promise<void>;
	afterFeature?: (vendor: Vendor) => Promise<void>;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

/**
 * Binds every scenario of a singular-write feature: each holds an optional
 * `Given these requests are sent:` and a `Then these requests get these
 * responses:`, both a request|response table run row after row.
 */
export function defineSingularWriteFeature(
	featurePath: string,
	featureHooks: FeatureHooks = {},
) {
	const feature = loadFeature(featurePath);

	describe.each(vendors)('%s', (vendor) => {
		if (featureHooks.beforeFeature) {
			beforeAll(() => {
				return featureHooks.beforeFeature!(vendor);
			});
		}

		if (featureHooks.afterFeature) {
			afterAll(() => {
				return featureHooks.afterFeature!(vendor);
			});
		}

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
// for a fresh uuid, or for the key a `remember: name` row stored before.
function withKeys(cell: string, scenarioKeys: ScenarioKeys) {
	return cell.replaceAll(/<([\w-]+)>/g, (_placeholder, name: string) => {
		if (name === 'run') {
			return scenarioKeys.run;
		}

		scenarioKeys.keysByName[name] ??= randomUUID();

		return scenarioKeys.keysByName[name];
	});
}

function sendRequest(vendor: Vendor, requestCell: RequestCell) {
	const { as: token, method, path, query = {}, payload } = requestCell;

	const pendingRequest = {
		DELETE: () => request(getUrl(vendor)).delete(path),
		GET: () => request(getUrl(vendor)).get(path),
		PATCH: () => request(getUrl(vendor)).patch(path),
		POST: () => request(getUrl(vendor)).post(path),
	}[method]();

	pendingRequest.query(query).set(
		'Authorization',
		token === undefined
			? AUTH
			: `Bearer ${token}`,
	);

	return payload === undefined
		? pendingRequest
		: pendingRequest.send(payload as object);
}

function codeAndBody(response: Response) {
	return { code: response.statusCode, body: response.body };
}

// One row at a time, so a row can name the key one before it remembered. A
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

		const expectedResponse = loadYaml(
			withKeys(responseText, scenarioKeys),
		) ?? {};

		if (requestCell.eventually) {
			await expect.poll(async () => {
				return codeAndBody(await sendRequest(vendor, requestCell));
			}, { timeout: 10_000, interval: 250 }).toMatchObject(
				expectedResponse,
			);

			continue;
		}

		const response = await sendRequest(vendor, requestCell);

		expect(codeAndBody(response)).toMatchObject(expectedResponse);

		if (requestCell.remember !== undefined) {
			scenarioKeys.keysByName[requestCell.remember] = String(
				response.body.data.id,
			);
		}
	}
}
