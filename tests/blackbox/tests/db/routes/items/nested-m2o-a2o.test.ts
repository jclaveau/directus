import { getUrl } from '@common/config';
import {
	defineFeature,
	loadFeature,
	messageOfDocString,
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

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const feature = loadFeature('./tests/db/routes/items/nested-m2o-a2o.feature');

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		for (const { title } of feature.scenarios) {
			scenario(title, ({ when, then }) => {
				const responses: request.Response[] = [];

				when(
					'these requests get these responses:',
					async (table: { request: string; response: string }[]) => {
						for (const { request: requestCell } of table) {
							const { method, path, query = {}, payload } = loadYaml(
								requestCell,
							) as RequestCell;

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
							return loadYaml(response) ?? {};
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
			}, 60_000);
		}
	});
});
