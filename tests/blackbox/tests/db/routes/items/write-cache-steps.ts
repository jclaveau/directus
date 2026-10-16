import { getUrl, type Env } from '@common/config';
import {
	cellOfKnownKeys,
	messageOfDocString,
	type StepFunctions,
} from '@common/cucumber';
import type { Vendor } from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { load as loadYaml } from 'js-yaml';
import request, { type Response } from 'supertest';
import { expect } from 'vitest';

type RequestCell = {
	method: 'DELETE' | 'GET' | 'PATCH' | 'POST';
	path: string;
	query?: Record<string, string>;
	payload?: unknown;
	instance?: 'cached' | 'uncached';
};

const REQUEST_CELL_KEYS = [
	'method',
	'path',
	'query',
	'payload',
	'instance',
] as const satisfies readonly (keyof RequestCell)[];

const RESPONSE_CELL_KEYS = ['code', 'cache', 'body'] as const;

export const cacheStatusHeader = 'x-cache-status';

/**
 * The write-coverage steps against a scoped-cache instance: a request|response
 * table whose response cell may state the `cache` status a read answered with,
 * and the message a response was refused with.
 */
export function defineWriteCacheSteps(
	{ when, then }: StepFunctions,
	vendor: Vendor,
	cachedEnv: Env,
) {
	const receivedResponses: Response[] = [];

	// A cell is YAML: the fork's multiline notation dedents it as a block.
	function sendRequest(requestCell: string) {
		const {
			method,
			path,
			query = {},
			payload,
			instance = 'cached',
		} = cellOfKnownKeys<RequestCell>(
			'request',
			loadYaml(requestCell),
			REQUEST_CELL_KEYS,
			'write-cache-steps.ts',
		);

		const instanceUrl = instance === 'cached'
			? getUrl(vendor, cachedEnv)
			: getUrl(vendor);

		const pendingRequest = {
			DELETE: () => request(instanceUrl).delete(path),
			GET: () => request(instanceUrl).get(path),
			PATCH: () => request(instanceUrl).patch(path),
			POST: () => request(instanceUrl).post(path),
		}[method]()
			.query(query)
			.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

		return payload === undefined
			? pendingRequest
			: pendingRequest.send(payload as object);
	}

	// Sent one after the other: a read is cached by the one before it.
	when(
		'these requests get these responses:',
		async (table: { request: string; response: string }[]) => {
			for (const { request: requestCell } of table) {
				receivedResponses.push(await sendRequest(requestCell));
			}

			expect(receivedResponses.map((receivedResponse) => {
				return {
					code: receivedResponse.statusCode,
					cache: receivedResponse.headers[cacheStatusHeader],
					body: receivedResponse.body,
				};
			})).toMatchObject(table.map(({ response }) => {
				return cellOfKnownKeys<object>(
					'response',
					loadYaml(response) ?? {},
					RESPONSE_CELL_KEYS,
					'write-cache-steps.ts',
				);
			}));
		},
	);

	// The probe answers a failure with its message alone.
	then.optional(
		new RegExp(
			'^responses? (\\d+(?: and \\d+)?) (?:is|are) refused by the probe'
			+ ' with the message:$',
		),
		(responsePositions: string, docString: string) => {
			const refusedPositions = responsePositions.split(' and ');

			expect(refusedPositions.map((responsePosition) => {
				return receivedResponses[Number(responsePosition) - 1]!.body;
			})).toEqual(refusedPositions.map(() => {
				return { message: messageOfDocString(docString) };
			}));
		},
	);

	then.optional(
		/^response (\d+) is refused with the message:$/,
		(responsePosition: string, docString: string) => {
			expect(
				receivedResponses[Number(responsePosition) - 1]!.body.errors,
			).toMatchObject([{ message: messageOfDocString(docString) }]);
		},
	);
}
