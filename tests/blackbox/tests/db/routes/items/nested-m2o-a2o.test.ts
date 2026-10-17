import {
	cellOfKnownKeys,
	defineFeature,
	loadFeature,
	messageOfDocString,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { load as loadYaml } from 'js-yaml';
import request from 'supertest';
import { describe, expect } from 'vitest';
import {
	defineStatementCountsStep,
	startAuditedInstance,
} from './query-audit-steps';

type RequestCell = {
	method: 'GET' | 'POST' | 'PATCH';
	path: string;
	query?: Record<string, string | string[]>;
	payload?: unknown;
};

const REQUEST_CELL_KEYS = [
	'method',
	'path',
	'query',
	'payload',
] as const satisfies readonly (keyof RequestCell)[];

const RESPONSE_CELL_KEYS = ['code', 'body'] as const;

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const feature = loadFeature('./tests/db/routes/items/nested-m2o-a2o.feature');

describe.each(vendors)('%s', (vendor) => {
	const instanceUrl = startAuditedInstance(vendor);

	defineFeature(feature, (scenario) => {
		for (const { title } of feature.scenarios) {
			scenario(title, ({ when, then, and }) => {
				const responses: request.Response[] = [];

				when(
					'these requests get these responses:',
					async (table: { request: string; response: string }[]) => {
						for (const { request: requestCell } of table) {
							const {
								method,
								path,
								query = {},
								payload,
							} = cellOfKnownKeys<RequestCell>(
								'request',
								loadYaml(requestCell),
								REQUEST_CELL_KEYS,
								'nested-m2o-a2o.test.ts',
							);

							const pendingRequest = {
								GET: () => request(instanceUrl()).get(path),
								POST: () => request(instanceUrl()).post(path),
								PATCH: () => request(instanceUrl()).patch(path),
							}[method]()
								.query(Object.fromEntries(
									Object.entries(query).map(([parameter, value]) => {
										return [parameter, [value].flat().join(',')];
									}),
								))
								.set('Authorization', AUTH);

							responses.push(await (payload === undefined
								? pendingRequest
								: pendingRequest.send(payload as object)));
						}

						expect(responses.map((response) => {
							return { code: response.statusCode, body: response.body };
						})).toMatchObject(table.map(({ response }) => {
							return cellOfKnownKeys<object>(
								'response',
								loadYaml(response) ?? {},
								RESPONSE_CELL_KEYS,
								'nested-m2o-a2o.test.ts',
							);
						}));
					},
				);

				then.optional(
					/^response (\d+) is refused with the message:$/,
					(responsePosition: string, docString: string) => {
						expect(
							responses[Number(responsePosition) - 1]!.body.errors,
						).toMatchObject([{ message: messageOfDocString(docString) }]);
					},
				);

				defineStatementCountsStep(and, vendor, responses);
			}, 60_000);
		}
	});
});
