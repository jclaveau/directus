import { getUrl } from '@common/config';
import { messageOfDocString, type StepFunctions } from '@common/cucumber';
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

/**
 * The steps the write-coverage features share: a request|response table, and
 * the message a response was refused with.
 */
export function defineWriteSteps(
	{ when, then, and }: StepFunctions,
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
		} = loadYaml(requestCell) as RequestCell;

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
				return loadYaml(response) ?? {};
			}));
		},
	);

	function expectRefusal(responsePosition: string, docString: string) {
		expect(
			receivedResponses[Number(responsePosition) - 1]!.body.errors,
		).toMatchObject([{ message: messageOfDocString(docString) }]);
	}

	then.optional(
		/^response (\d+) is refused with the message:$/,
		expectRefusal,
	);

	and.optional(
		/^response (\d+) is refused with the message:$/,
		expectRefusal,
	);
}
