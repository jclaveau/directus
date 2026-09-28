import { getUrl } from '@common/config';
import {
	defineFeature,
	loadFeature,
	type StepFunctions,
} from '@common/cucumber';
import {
	CreateCollections,
	CreateItem,
	DeleteCollection,
} from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { sleep } from '@utils/sleep';
import { randomUUID } from 'crypto';
import { createClient, type Client } from 'graphql-ws';
import { load as loadYaml } from 'js-yaml';
import request from 'supertest';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect } from 'vitest';

const COLLECTION = 'ip_gated';

const READ_QUERY = `{
	${COLLECTION}(filter: { label: { _eq: "gated" } }) {
		label
	}
}`;

const feature = loadFeature(
	'./tests/db/routes/items/graphql-ip-gated-read.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const auth = `Bearer ${USER.ADMIN.TOKEN}`;

	// Every user a scenario created, removed once the file is done with them.
	const createdUserIds: string[] = [];
	// Every websocket a scenario opened, closed once the file is done with them.
	const openedClients: Client[] = [];
	let policyId: string;

	beforeAll(async () => {
		await CreateCollections(vendor, {
			collections: [{
				collection: COLLECTION,
				meta: {},
				fields: [{ field: 'label', type: 'string', meta: {} }],
			}],
		});

		await CreateItem(vendor, {
			collection: COLLECTION,
			item: { label: 'gated' },
		});

		const response = await request(getUrl(vendor))
			.post('/policies')
			.send({
				name: `ip-gated-read-${randomUUID()}`,
				app_access: false,
				admin_access: false,
				ip_access: ['10.10.10.1'],
				permissions: [{
					collection: COLLECTION,
					action: 'read',
					fields: ['*'],
					permissions: {},
				}],
			})
			.set('Authorization', auth);

		expect(response.statusCode).toBe(200);
		policyId = response.body.data.id;
	}, 60_000);

	afterAll(async () => {
		for (const client of openedClients) {
			await client.dispose();
		}

		for (const userId of createdUserIds) {
			await request(getUrl(vendor))
				.delete(`/users/${userId}`)
				.set('Authorization', auth);
		}

		await request(getUrl(vendor))
			.delete(`/policies/${policyId}`)
			.set('Authorization', auth);

		await DeleteCollection(vendor, { collection: COLLECTION });
	});

	// Created by the scenario that reads as them, so the schema their first
	// request builds is theirs alone.
	async function createUser() {
		const token = randomUUID();

		const response = await request(getUrl(vendor))
			.post('/users')
			.send({
				email: `reader-${token}@ip-gated.example.com`,
				token,
				policies: [{ policy: policyId }],
			})
			.set('Authorization', auth);

		expect(response.statusCode).toBe(200);
		createdUserIds.push(response.body.data.id);

		return token;
	}

	async function readOverHttp(token: string, ip: string) {
		const response = await request(getUrl(vendor))
			.post('/graphql')
			.send({ query: READ_QUERY })
			.set('Authorization', `Bearer ${token}`)
			.set('X-Forwarded-For', ip);

		return response.body as ReadResult;
	}

	// The upgrade request is where a websocket takes its IP from.
	function openWebsocket(token: string, ip: string) {
		class ForwardedWebSocket extends WebSocket {
			constructor(url: string, protocols?: string | string[]) {
				super(url, protocols, { headers: { 'X-Forwarded-For': ip } });
			}
		}

		const client = createClient({
			url: `ws://${getUrl(vendor).split('//')[1]}/graphql`,
			webSocketImpl: ForwardedWebSocket,
			connectionParams: { access_token: token },
			lazy: false,
		});

		openedClients.push(client);

		return client;
	}

	function defineGivenSteps(
		{ given, and }: StepFunctions,
		reader: Reader,
	) {
		given.optional(
			/^a user whose schema is built by a read from "(.*)"$/,
			async (ip: string) => {
				reader.token = await createUser();

				expect(await readOverHttp(reader.token, ip)).toEqual({
					data: { [COLLECTION]: [{ label: 'gated' }] },
				});
			},
		);

		and.optional(
			/^the user subscribes to created rows from "(.*)" and "(.*)"$/,
			async (insideIp: string, outsideIp: string) => {
				reader.insideIp = insideIp;

				for (const ip of [insideIp, outsideIp]) {
					const received: unknown[] = [];
					reader.received[ip] = received;

					openWebsocket(reader.token, ip).subscribe(
						{
							query: `subscription {
								${COLLECTION}_mutated(event: create) { data { label } }
							}`,
						},
						{
							next: (message) => received.push(message),
							error: (error) => received.push({ error }),
							complete: () => undefined,
						},
					);
				}
			},
		);
	}

	function defineWhenSteps(
		{ when }: StepFunctions,
		reader: Reader,
	) {
		when.optional(
			/^the user reads the rows over HTTP from "(.*)"$/,
			async (ip: string) => {
				reader.result = await readOverHttp(reader.token, ip);
			},
		);

		when.optional(
			/^the user reads the rows over a websocket from "(.*)"$/,
			async (ip: string) => {
				const results = openWebsocket(reader.token, ip)
					.iterate({ query: READ_QUERY });

				const { value } = await results.next();
				reader.result = value as ReadResult;
			},
		);

		when.optional(
			/^a row labelled "(.*)" is created$/,
			async (label: string) => {
				// A subscription starts listening only once the server has read its
				// first message, so rows are created until the one allowed to
				// receive them does.
				const insideReceived = reader.received[reader.insideIp!]!;

				for (let attempt = 0; attempt < 20; attempt++) {
					await CreateItem(vendor, {
						collection: COLLECTION,
						item: { label },
					});

					await sleep(500);

					if (insideReceived.length > 0) {
						break;
					}
				}
			},
		);
	}

	function defineThenSteps(
		{ then, and }: StepFunctions,
		reader: Reader,
	) {
		// Over HTTP a refused read carries no `data`, over a websocket a null one.
		then.optional('the read is refused', () => {
			expect(reader.result).toMatchObject({
				errors: [{ message: expect.stringMatching(/permission/) }],
			});

			expect(reader.result).not.toHaveProperty(['data', COLLECTION]);
		});

		then.optional('the read answers:', (docString: string) => {
			expect(reader.result).toEqual({ data: loadYaml(docString) });
		});

		then.optional(
			/^the subscription from "(.*)" receives it$/,
			(ip: string) => {
				expect(reader.received[ip]![0]).toEqual({
					data: {
						[`${COLLECTION}_mutated`]: { data: { label: 'created' } },
					},
				});
			},
		);

		// Refused either with an error or with silence, depending on which schema
		// serves the subscription (#554), never with a row.
		and.optional(
			/^the subscription from "(.*)" receives no row$/,
			(ip: string) => {
				expect(reader.received[ip]).not.toContainEqual(
					expect.objectContaining({ data: expect.anything() }),
				);
			},
		);
	}

	type ReadResult = { data?: unknown; errors?: unknown[] };

	type Reader = {
		token: string;
		result?: ReadResult;
		insideIp?: string;
		received: Record<string, unknown[]>;
	};

	defineFeature(feature, (scenario) => {
		scenario(
			'a read over HTTP from outside the range is refused',
			(steps) => {
				const reader: Reader = { token: '', received: {} };

				defineGivenSteps(steps, reader);

				defineWhenSteps(steps, reader);

				defineThenSteps(steps, reader);
			},
			60_000,
		);

		scenario(
			'a read over a websocket from outside the range is refused',
			(steps) => {
				const reader: Reader = { token: '', received: {} };

				defineGivenSteps(steps, reader);

				defineWhenSteps(steps, reader);

				defineThenSteps(steps, reader);
			},
			60_000,
		);

		scenario(
			'a read over a websocket from inside the range answers',
			(steps) => {
				const reader: Reader = { token: '', received: {} };

				defineGivenSteps(steps, reader);

				defineWhenSteps(steps, reader);

				defineThenSteps(steps, reader);
			},
			60_000,
		);

		scenario(
			'a subscription from outside the range receives no row',
			(steps) => {
				const reader: Reader = { token: '', received: {} };

				defineGivenSteps(steps, reader);

				defineWhenSteps(steps, reader);

				defineThenSteps(steps, reader);
			},
			60_000,
		);
	});
});
