import { getUrl } from '@common/config';
import {
	cellOfKnownKeys,
	defineFeature,
	loadFeature,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { load as loadYaml } from 'js-yaml';
import request from 'supertest';
import { describe, expect } from 'vitest';

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

const feature = loadFeature('./tests/db/routes/items/upsert-singleton.feature');

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		for (const { title } of feature.scenarios) {
			scenario(title, ({ when }) => {
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
								'upsert-singleton.test.ts',
							);

							const pendingRequest = {
								GET: () => request(getUrl(vendor)).get(path),
								POST: () => request(getUrl(vendor)).post(path),
								PATCH: () => request(getUrl(vendor)).patch(path),
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
								'upsert-singleton.test.ts',
							);
						}));
					},
				);
			}, 60_000);
		}
	});
});
