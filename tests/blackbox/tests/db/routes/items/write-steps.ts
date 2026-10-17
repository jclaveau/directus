import { getUrl } from '@common/config';
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
	query?: Record<string, string | string[]>;
	payload?: unknown;
	file?: unknown;
	token?: string;
};

const REQUEST_CELL_KEYS = [
	'method',
	'path',
	'query',
	'payload',
	'file',
	'token',
] as const satisfies readonly (keyof RequestCell)[];

const RESPONSE_CELL_KEYS = ['code', 'body'] as const;

/**
 * The steps the write-coverage features share: a request|response table, and
 * the message a response was refused with.
 */
export function defineWriteSteps(
	{ when, then }: StepFunctions,
	vendor: Vendor,
) {
	const receivedResponses: Response[] = [];

	// A cell is YAML: the fork's multiline notation dedents it as a block.
	function sendRequest(requestCell: string) {
		const {
			method,
			path,
			query = {},
			payload,
			file,
			token = USER.ADMIN.TOKEN,
		} = cellOfKnownKeys<RequestCell>(
			'request',
			loadYaml(requestCell),
			REQUEST_CELL_KEYS,
			'write-steps.ts',
		);

		const pendingRequest = {
			DELETE: () => request(getUrl(vendor)).delete(path),
			GET: () => request(getUrl(vendor)).get(path),
			PATCH: () => request(getUrl(vendor)).patch(path),
			POST: () => request(getUrl(vendor)).post(path),
		}[method]()
			.query(Object.fromEntries(
				Object.entries(query).map(([parameter, value]) => {
					return [parameter, [value].flat().join(',')];
				}),
			))
			.set('Authorization', `Bearer ${token}`);

		// A `file` is the JSON an import reads, sent as the upload it expects.
		if (file !== undefined) {
			return pendingRequest.attach(
				'file',
				Buffer.from(JSON.stringify(file)),
				{ filename: 'rows.json', contentType: 'application/json' },
			);
		}

		return payload === undefined
			? pendingRequest
			: pendingRequest.send(payload as object);
	}

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
				return cellOfKnownKeys<object>(
					'response',
					loadYaml(response) ?? {},
					RESPONSE_CELL_KEYS,
					'write-steps.ts',
				);
			}));
		},
	);

	// One definition whatever the step's keyword: jest-cucumber counts every
	// registration against the scenario's steps.
	then.optional(
		/^response (\d+) is refused with the message:$/,
		(responsePosition: string, docString: string) => {
			expect(
				receivedResponses[Number(responsePosition) - 1]!.body.errors,
			).toMatchObject([{ message: messageOfDocString(docString) }]);
		},
	);
}
