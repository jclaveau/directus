import { parseGherkinTable, type StepFunctions } from '@common/cucumber';
import type { Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { load as loadYaml } from 'js-yaml';
import request, { type Response } from 'supertest';
import { expect } from 'vitest';
import { defineStatementCountsStep } from './query-audit-steps';

type RequestCell = {
	method: 'GET' | 'PATCH' | 'POST';
	path: string;
	query?: Record<string, string>;
	payload?: unknown;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

/**
 * The steps both nested-o2m features share: rows created through their
 * collection, a request|response table, the rows read back by key prefix, and
 * the statements the requests ran, all sent to the instance at `instanceUrl`.
 */
export function defineNestedWriteSteps(
	{ given, and, when, then }: StepFunctions,
	vendor: Vendor,
	instanceUrl: () => string,
) {
	const receivedResponses: Response[] = [];

	async function createRows(
		collection: string,
		table: Record<string, string>[],
	) {
		const response = await request(instanceUrl())
			.post(`/items/${collection}`)
			.send(parseGherkinTable(table))
			.set('Authorization', AUTH);

		expect(response.statusCode).toEqual(200);
	}

	// A cell is YAML: the fork's multiline notation dedents it as a block.
	function sendRequest(requestCell: string) {
		const { method, path, query = {}, payload } = loadYaml(
			requestCell,
		) as RequestCell;

		const pendingRequest = {
			GET: () => request(instanceUrl()).get(path),
			PATCH: () => request(instanceUrl()).patch(path),
			POST: () => request(instanceUrl()).post(path),
		}[method]();

		pendingRequest.query(query).set('Authorization', AUTH);

		return payload === undefined
			? pendingRequest
			: pendingRequest.send(payload as object);
	}

	given.optional(/^the rows of (\S+):$/, createRows);

	and.optional(/^their children in (\S+):$/, createRows);

	// A response cell states the keys it checks; an array still has to hold as
	// many items as it states.
	when(
		'these requests get these responses:',
		async (table: { request: string; response: string }[]) => {
			for (const { request: requestCell } of table) {
				receivedResponses.push(await sendRequest(requestCell));
			}

			expect(receivedResponses.map((receivedResponse) => {
				return {
					code: receivedResponse.statusCode,
					body: receivedResponse.body,
				};
			})).toMatchObject(table.map(({ response }) => {
				return loadYaml(response) ?? {};
			}));
		},
	);

	then(
		/^the rows of (\S+) whose key starts with "([^"]+)" are:$/,
		async (
			collection: string,
			keyPrefix: string,
			table: Record<string, string>[],
		) => {
			const response = await request(instanceUrl())
				.get(`/items/${collection}`)
				.query({
					'filter[id][_starts_with]': keyPrefix,
					fields: Object.keys(table[0]!).join(','),
					sort: 'id',
					limit: -1,
				})
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
			expect(response.body.data).toEqual(parseGherkinTable(table));
		},
	);

	defineStatementCountsStep(and, vendor, receivedResponses);
}
