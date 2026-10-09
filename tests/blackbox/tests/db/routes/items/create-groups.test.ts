import { getUrl } from '@common/config';
import {
	defineFeature,
	loadFeature,
	type StepFunctions,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { oneLine } from '@directus/utils';
import { load as loadYaml } from 'js-yaml';
import request, { type Response } from 'supertest';
import { describe, expect } from 'vitest';
import { collectionCreatedLog } from './create-groups.seed';

type RequestCell = {
	method: 'GET' | 'POST';
	path: string;
	query?: Record<string, string>;
	payload?: unknown;
};

type Exchanges = { responses: Response[] };

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const feature = loadFeature('./tests/db/routes/items/create-groups.feature');

describe.each(vendors)('%s', (vendor) => {
	// A cell is YAML: the fork's multiline notation dedents it as a block.
	function sendRequest(requestCell: string) {
		const { method, path, query = {}, payload } = loadYaml(
			requestCell,
		) as RequestCell;

		const pendingRequest = method === 'POST'
			? request(getUrl(vendor)).post(path)
			: request(getUrl(vendor)).get(path);

		pendingRequest.query(query).set('Authorization', AUTH);

		return payload === undefined
			? pendingRequest
			: pendingRequest.send(payload as object);
	}

	// The log is shared by every scenario and never cleared: a step reads back
	// only the entries holding its own rows' names.
	async function readLoggedPayloads(
		event: string,
		phase: string,
		names: string[],
	) {
		const response = await request(getUrl(vendor))
			.get(`/items/${collectionCreatedLog}`)
			.query({
				filter: JSON.stringify({
					event: { _eq: event },
					phase: { _eq: phase },
					_or: names.map((name) => {
						return { payload: { _contains: `"name":"${name}"` } };
					}),
				}),
				fields: 'payload',
				sort: 'id',
				limit: -1,
			})
			.set('Authorization', AUTH);

		expect(response.statusCode).toEqual(200);

		return response.body.data.map((entry: { payload: string }) => {
			return JSON.parse(entry.payload);
		});
	}

	async function expectEventCounts(
		names: string[],
		table: Record<string, string>[],
	) {
		const counts = await Promise.all(table.map(async ({ event, phase }) => {
			return {
				event,
				phase,
				count: String(
					(await readLoggedPayloads(event!, phase!, names)).length,
				),
			};
		}));

		expect(counts).toEqual(table);
	}

	function defineSteps(
		{ when, then, and }: StepFunctions,
		exchanges: Exchanges,
	) {
		// A response cell states the keys it checks; an array still has to hold as
		// many items as it states.
		when(
			'these requests get these responses:',
			async (table: { request: string; response: string }[]) => {
				for (const { request: requestCell } of table) {
					exchanges.responses.push(await sendRequest(requestCell));
				}

				expect(exchanges.responses.map((response) => {
					return { code: response.statusCode, body: response.body };
				})).toMatchObject(table.map(({ response }) => {
					return loadYaml(response) ?? {};
				}));
			},
		);

		then.optional(
			/^the grouped filter naming "(.*)" received:$/,
			async (name: string, table: { entries: string }[]) => {
				expect(await readLoggedPayloads('items.create', 'filter', [name]))
					.toEqual(table.map(({ entries }) => loadYaml(entries)));
			},
		);

		and.optional(
			/^the create events naming "(.*)" or "(.*)" are:$/,
			async (
				firstName: string,
				secondName: string,
				table: Record<string, string>[],
			) => {
				await expectEventCounts([firstName, secondName], table);
			},
		);

		then.optional(
			/^the first refusal names "(.*)"$/,
			(eventName: string) => {
				expect(exchanges.responses[0]!.body.errors[0].message)
					.toContain(`"${eventName}"`);
			},
		);

		then.optional(
			/^the create events naming "([^"]*)" are:$/,
			async (name: string, table: Record<string, string>[]) => {
				await expectEventCounts([name], table);
			},
		);

		and.optional(
			/^the grouped action naming "(.*)" carries that row alone$/,
			async (name: string) => {
				expect(await readLoggedPayloads('items.create', 'action', [name]))
					.toEqual([[{ id: expect.any(Number), name }]]);
			},
		);
	}

	defineFeature(feature, (scenario) => {
		for (const title of [
			'a create fires the grouped event once, then the per-row one per row',
			'a grouped hook answering with one payload is refused',
			oneLine`
				a grouped hook deleting a field off the list is refused, creating
				nothing
			`,
			oneLine`
				a grouped hook reading a field off the list is refused, creating
				nothing
			`,
			'a grouped hook marking a twin inserts the row once',
			'a grouped hook cancelling one row writes its siblings',
			'a row a grouped hook takes over is left out of the grouped action',
		]) {
			scenario(title, (steps) => {
				defineSteps(steps, { responses: [] });
			}, 60_000);
		}
	});
});
