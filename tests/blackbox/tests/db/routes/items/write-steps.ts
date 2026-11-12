import {
	cellOfKnownKeys,
	messageOfDocString,
	responseCellOf,
	type StepFunctions,
} from '@common/cucumber';
import type { Vendor } from '@common/get-dbs-to-test';
import { defineStatementCountsStep } from '@common/query-audit-steps';
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
	as?: string;
	remember?: string;
};

const REQUEST_CELL_KEYS = [
	'method',
	'path',
	'query',
	'payload',
	'file',
	'token',
	'as',
	'remember',
] as const satisfies readonly (keyof RequestCell)[];

const RESPONSE_CELL_KEYS = ['code', 'body'] as const;

/**
 * The steps the write-coverage features share: a request|response table, the
 * message a response was refused with, and the statements the requests ran.
 * The requests go to the instance `instanceUrl` names.
 */
export function defineWriteSteps(
	{ when, then, and }: StepFunctions,
	vendor: Vendor,
	instanceUrl: () => string,
) {
	const receivedResponses: Response[] = [];

	// The credentials a login answered, by the name its row remembered them as.
	const rememberedCredentials: Record<string, Record<string, string>> = {};

	// A request sends the admin's token, another `token`, the credentials a
	// login remembered under `as`, or none when `as` is `public`.
	function credentialHeadersOf(token: string | undefined, as?: string) {
		if (token !== undefined && as !== undefined) {
			throw new Error(
				`A request names both the token "${token}" and the credentials `
				+ `"${as}": it sends one or the other`,
			);
		}

		if (as === 'public') {
			return {};
		}

		if (as !== undefined) {
			const credentialHeaders = rememberedCredentials[as];

			if (credentialHeaders === undefined) {
				throw new Error(
					`No login remembered the credentials "${as}" before the `
					+ 'request sending them',
				);
			}

			return credentialHeaders;
		}

		return { Authorization: `Bearer ${token ?? USER.ADMIN.TOKEN}` };
	}

	// A json login answers its access token, a session login its cookie.
	function credentialHeadersAnswered(loginResponse: Response) {
		const accessToken = loginResponse.body?.data?.access_token;

		if (typeof accessToken === 'string') {
			return { Authorization: `Bearer ${accessToken}` };
		}

		const setCookies = [loginResponse.headers['set-cookie'] ?? []].flat();

		if (setCookies.length === 0) {
			throw new Error(
				`The login answered ${loginResponse.statusCode} with neither an `
				+ 'access token nor a cookie to remember',
			);
		}

		return {
			Cookie: setCookies.map((setCookie) => {
				return setCookie.split(';')[0];
			}).join('; '),
		};
	}

	// A cell is YAML: the fork's multiline notation dedents it as a block.
	async function sendRequest(requestCell: string) {
		const {
			method,
			path,
			query = {},
			payload,
			file,
			token,
			as,
			remember,
		} = cellOfKnownKeys<RequestCell>(
			'request',
			loadYaml(requestCell),
			REQUEST_CELL_KEYS,
			'write-steps.ts',
		);

		const receivedResponse = await sentRequest({
			method,
			path,
			query,
			payload,
			file,
			credentialHeaders: credentialHeadersOf(token, as),
		});

		if (remember !== undefined) {
			rememberedCredentials[remember]
				= credentialHeadersAnswered(receivedResponse);
		}

		return receivedResponse;
	}

	function sentRequest({
		method,
		path,
		query,
		payload,
		file,
		credentialHeaders,
	}: Omit<RequestCell, 'token' | 'as' | 'remember'> & {
		query: Record<string, string | string[]>;
		credentialHeaders: Record<string, string>;
	}) {
		const pendingRequest = {
			DELETE: () => request(instanceUrl()).delete(path),
			GET: () => request(instanceUrl()).get(path),
			PATCH: () => request(instanceUrl()).patch(path),
			POST: () => request(instanceUrl()).post(path),
		}[method]()
			.query(Object.fromEntries(
				Object.entries(query).map(([parameter, value]) => {
					return [parameter, [value].flat().join(',')];
				}),
			))
			.set(credentialHeaders);

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
				return responseCellOf<object>(
					loadYaml(response),
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

	defineStatementCountsStep(and, vendor, receivedResponses);
}
