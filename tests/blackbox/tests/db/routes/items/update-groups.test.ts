import { getUrl } from '@common/config';
import {
	defineFeature,
	loadFeature,
	messageOfDocString,
	parseGherkinTable,
	type StepFunctions,
} from '@common/cucumber';
import { CreateItem, CreatePermission } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { oneLine } from '@directus/utils';
import { randomUUID } from 'crypto';
import { pickBy } from 'lodash-es';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect } from 'vitest';
import {
	collectionGrouped,
	collectionGroupedLog,
	collectionGroupedOwner,
	collectionGroupedBadge,
	collectionGroupedSlot,
} from './update-groups.seed';

type GroupedRow = {
	id: number | string;
	name: string;
	status: string | null;
};
type UpdateGroupLogged = { data: { status?: string }; keys: number[] };

type Update = {
	collection: string;
	rows: GroupedRow[];
	malformedKey: string;
	authorization: string;
	response?: request.Response;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const feature = loadFeature(
	'./tests/db/routes/items/update-groups.feature',
);

describe.each(vendors)('%s', (vendor) => {
	const createdUserIds: string[] = [];

	afterAll(async () => {
		const usersResponse = await request(getUrl(vendor))
			.delete('/users')
			.send(createdUserIds)
			.set('Authorization', AUTH);

		expect(usersResponse.statusCode).toEqual(204);

		const policiesResponse = await request(getUrl(vendor))
			.get('/policies')
			.query({
				'filter[name][_eq]': `${USER.APP_ACCESS.KEY}-Update Groups`,
				fields: 'id',
			})
			.set('Authorization', AUTH);

		for (const policy of policiesResponse.body.data) {
			const policyResponse = await request(getUrl(vendor))
				.delete(`/policies/${policy.id}`)
				.set('Authorization', AUTH);

			expect(policyResponse.statusCode).toEqual(204);
		}
	});

	// Every scenario starts on an empty log, so a count holds only its own events.
	beforeEach(async () => {
		const response = await request(getUrl(vendor))
			.delete(`/items/${collectionGroupedLog}`)
			.send({ query: { limit: -1 } })
			.set('Authorization', AUTH);

		expect(response.statusCode).toEqual(204);
	});

	async function readLoggedPayloads(event: string, phase: string) {
		const response = await request(getUrl(vendor))
			.get(`/items/${collectionGroupedLog}`)
			.query({
				'filter[event][_eq]': event,
				'filter[phase][_eq]': phase,
				fields: 'payload',
				sort: 'id',
				limit: -1,
			})
			.set('Authorization', AUTH);

		expect(response.statusCode).toEqual(200);

		return response.body.data.map((entry: { payload: string }) => entry.payload);
	}

	// A key naming no row of the scenario reads as undefined, failing the step's
	// comparison rather than throwing.
	function namesOf(update: Update, keys: number[]) {
		const nameByKey = Object.fromEntries(update.rows.map((row) => {
			return [row.id, row.name];
		}));

		return keys.map((key) => nameByKey[key]);
	}

	function defineSteps(
		{ given, when, then, and }: StepFunctions,
		update: Update,
	) {
		given.optional('the rows:', async (table: Record<string, string>[]) => {
			update.rows = await CreateItem(vendor, {
				collection: collectionGrouped,
				item: parseGherkinTable<{ name: string }>(table),
			});
		});

		given.optional(
			'the rows, in the collection no update hook listens to:',
			async (table: Record<string, string>[]) => {
				update.collection = collectionGroupedOwner;

				update.rows = await CreateItem(vendor, {
					collection: collectionGroupedOwner,
					item: parseGherkinTable<{ name: string }>(table),
				});
			},
		);

		given.optional(
			'the rows, in the collection holding each slot once per holder:',
			async (table: Record<string, string>[]) => {
				update.collection = collectionGroupedSlot;

				update.rows = await CreateItem(vendor, {
					collection: collectionGroupedSlot,
					item: parseGherkinTable<{
						name: string;
						holder: string;
						slot: string | null;
					}>(table),
				});
			},
		);

		given.optional(
			'the rows, in the collection keyed by uuid:',
			async (table: Record<string, string>[]) => {
				update.collection = collectionGroupedBadge;

				update.rows = await CreateItem(vendor, {
					collection: collectionGroupedBadge,
					item: parseGherkinTable<{ name: string }>(table),
				});
			},
		);

		given.optional(
			'the requests authenticate as a user who may read and update the rows',
			async () => {
				for (const action of ['read', 'update'] as const) {
					await CreatePermission(vendor, {
						role: USER.APP_ACCESS.KEY,
						permission: {
							collection: collectionGrouped,
							action,
							permissions: {},
							fields: ['*'],
						},
						policyName: 'Update Groups',
					});
				}

				update.authorization = `Bearer ${USER.APP_ACCESS.TOKEN}`;
			},
		);

		given.optional('the users:', async (table: Record<string, string>[]) => {
			const response = await request(getUrl(vendor))
				.post('/users')
				.query({ fields: 'id,first_name,status', sort: 'first_name' })
				.send(parseGherkinTable<{ name: string }>(table).map((user) => {
					return {
						first_name: user.name,
						email: `${user.name}-${randomUUID()}@example.com`,
					};
				}))
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);

			update.rows = response.body.data.map((user: {
				id: string;
				first_name: string;
				status: string;
			}) => {
				return { id: user.id, name: user.first_name, status: user.status };
			});

			createdUserIds.push(...update.rows.map((row) => String(row.id)));
		});

		function batchOf(table: Record<string, string>[]) {
			return parseGherkinTable<{ name: string; status: string | null }>(
				table,
			).map((change) => {
				const id = update.rows.find((row) => row.name === change.name)!.id;

				return change.status === null
					? { id }
					: { id, status: change.status };
			});
		}

		when.optional('the batch sends:', async (table: Record<string, string>[]) => {
			update.response = await request(getUrl(vendor))
				.patch(`/items/${update.collection}`)
				.query({ fields: 'name,status', sort: 'id' })
				.send(batchOf(table))
				.set('Authorization', update.authorization);
		});

		when.optional(
			/^the batch sends, with onRepeatedPk "(.*)":$/,
			async (onRepeatedPk: string, table: Record<string, string>[]) => {
				update.response = await request(getUrl(vendor))
					.patch(`/items/${update.collection}`)
					.query({ fields: 'name,status', sort: 'id', onRepeatedPk })
					.send(batchOf(table))
					.set('Authorization', update.authorization);
			},
		);

		when.optional(
			'the batch sends, the key of its last row in capitals:',
			async (table: Record<string, string>[]) => {
				const sentChanges = batchOf(table);
				const lastChange = sentChanges.at(-1)!;

				update.response = await request(getUrl(vendor))
					.patch(`/items/${update.collection}`)
					.send([
						...sentChanges.slice(0, -1),
						{ ...lastChange, id: String(lastChange.id).toUpperCase() },
					])
					.set('Authorization', update.authorization);
			},
		);

		when.optional(
			'the batch sends, the key of its last row with a leading zero:',
			async (table: Record<string, string>[]) => {
				const sentChanges = batchOf(table);
				const lastChange = sentChanges.at(-1)!;

				update.response = await request(getUrl(vendor))
					.patch(`/items/${update.collection}`)
					.send([
						...sentChanges.slice(0, -1),
						{ ...lastChange, id: `0${lastChange.id}` },
					])
					.set('Authorization', update.authorization);
			},
		);

		when.optional(
			/^the batch is sent over GraphQL(?:, with onRepeatedPk (\w+))?:$/,
			async (
				onRepeatedPk: string | undefined,
				table: Record<string, string>[],
			) => {
				update.response = await request(getUrl(vendor))
					.post('/graphql')
					.send({
						query: `
							mutation ($rows: [update_${update.collection}_input!]) {
								update_${update.collection}_batch(
									data: $rows
									${onRepeatedPk
										? `onRepeatedPk: ${onRepeatedPk}`
										: ''}
								) { name status }
							}
						`,
						variables: { rows: batchOf(table) },
					})
					.set('Authorization', update.authorization);
			},
		);

		when.optional(
			/^the users batch is sent over GraphQL(?:, with onRepeatedPk (\w+))?:$/,
			async (
				onRepeatedPk: string | undefined,
				table: Record<string, string>[],
			) => {
				update.response = await request(getUrl(vendor))
					.post('/graphql/system')
					.send({
						query: `
							mutation ($rows: [update_directus_users_input!]) {
								update_users_batch(
									data: $rows
									${onRepeatedPk
										? `onRepeatedPk: ${onRepeatedPk}`
										: ''}
								) { id }
							}
						`,
						variables: { rows: batchOf(table) },
					})
					.set('Authorization', AUTH);
			},
		);

		when.optional('the OAS is read', async () => {
			update.response = await request(getUrl(vendor))
				.get('/server/specs/oas')
				.set('Authorization', AUTH);
		});

		when.optional(
			'the batch sends the slots:',
			async (table: Record<string, string>[]) => {
				update.response = await request(getUrl(vendor))
					.patch(`/items/${update.collection}`)
					.send(parseGherkinTable<{ name: string; slot: string }>(table)
						.map((change) => {
							return {
								id: update.rows.find((row) => row.name === change.name)!.id,
								slot: change.slot,
							};
						}))
					.set('Authorization', update.authorization);
			},
		);

		when.optional(
			'the batch sends the owners, a blank one as null:',
			async (table: Record<string, string>[]) => {
				update.response = await request(getUrl(vendor))
					.patch(`/items/${update.collection}`)
					.send(parseGherkinTable<{ name: string; owner: number | null }>(table)
						.map((change) => {
							return {
								id: update.rows.find((row) => row.name === change.name)!.id,
								owner: change.owner,
							};
						}))
					.set('Authorization', update.authorization);
			},
		);

		// A blank cell leaves that field out of the row's change.
		when.optional(
			'the batch sends the slots and labels:',
			async (table: Record<string, string>[]) => {
				update.response = await request(getUrl(vendor))
					.patch(`/items/${update.collection}`)
					.send(parseGherkinTable<{
						name: string;
						slot: string | null;
						label: string | null;
					}>(table).map(({ name, ...fields }) => {
						return {
							id: update.rows.find((row) => row.name === name)!.id,
							...pickBy(fields, (value) => value !== null),
						};
					}))
					.set('Authorization', update.authorization);
			},
		);

		when.optional(
			/^the rows are updated to the status "(.*)"$/,
			async (status: string) => {
				update.response = await request(getUrl(vendor))
					.patch(`/items/${collectionGrouped}`)
					.send({ keys: update.rows.map((row) => row.id), data: { status } })
					.set('Authorization', update.authorization);
			},
		);

		when.optional(
			/^the rows are sent twice, updated to the status "(.*)"$/,
			async (status: string) => {
				update.response = await request(getUrl(vendor))
					.patch(`/items/${collectionGrouped}`)
					.send({
						keys: update.rows.flatMap((row) => [row.id, row.id]),
						data: { status },
					})
					.set('Authorization', update.authorization);
			},
		);

		when.optional(
			/^a malformed key is updated to the status "(.*)"$/,
			async (status: string) => {
				update.response = await request(getUrl(vendor))
					.patch(`/items/${collectionGrouped}`)
					.send({ keys: [update.malformedKey], data: { status } })
					.set('Authorization', AUTH);
			},
		);

		when.optional(
			/^no row is updated to the status "(.*)"$/,
			async (status: string) => {
				update.response = await request(getUrl(vendor))
					.patch(`/items/${collectionGrouped}`)
					.send({ keys: [], data: { status } })
					.set('Authorization', AUTH);
			},
		);

		when.optional(
			/^the rows are updated to point at a new owner named "(.*)"$/,
			async (ownerName: string) => {
				update.response = await request(getUrl(vendor))
					.patch(`/items/${collectionGrouped}`)
					.send({
						keys: update.rows.map((row) => row.id),
						data: { owner: { name: ownerName } },
					})
					.set('Authorization', update.authorization);
			},
		);

		when.optional(
			'the users batch sends:',
			async (table: Record<string, string>[]) => {
				update.response = await request(getUrl(vendor))
					.patch('/users')
					.send(batchOf(table))
					.set('Authorization', AUTH);
			},
		);

		then.optional('the update succeeds', () => {
			expect(update.response!.statusCode).toEqual(200);
		});

		then.optional('the update answers:', (table: Record<string, string>[]) => {
			expect(update.response!.statusCode).toEqual(200);
			expect(update.response!.body.data).toEqual(parseGherkinTable(table));
		});

		then.optional(
			/^the grouped (filter|action) carries:$/,
			async (phase: string, table: Record<string, string>[]) => {
				expect(update.response!.statusCode).toEqual(200);

				// Every grouped event of the scenario, so a second one fails the
				// comparison.
				const loggedEvents: UpdateGroupLogged[][] = (
					await readLoggedPayloads('items.update', phase)
				).map((payload: string) => JSON.parse(payload));

				expect(loggedEvents.map((groups) => {
					return groups.map((group) => {
						return {
							status: group.data.status,
							names: namesOf(update, group.keys),
						};
					});
				})).toEqual([parseGherkinTable(table)]);
			},
		);

		then.optional(
			'the update is refused with the message:',
			(docString: string) => {
				expect(update.response!.statusCode).toEqual(400);

				expect(update.response!.body.errors[0].message)
					.toEqual(messageOfDocString(docString, (rowName) => {
						return update.rows.find((row) => row.name === rowName)!.id;
					}));
			},
		);

		then.optional('the GraphQL update succeeds', () => {
			expect(update.response!.statusCode).toEqual(200);
			expect(update.response!.body.errors).toBeUndefined();
		});

		then.optional(
			'the GraphQL update is refused with the message:',
			(docString: string) => {
				expect(update.response!.statusCode).toEqual(200);

				expect(update.response!.body.errors[0].message)
					.toEqual(messageOfDocString(docString, (rowName) => {
						return update.rows.find((row) => row.name === rowName)!.id;
					}));
			},
		);

		// A query the schema refuses never runs, so its reason sits one level down.
		then.optional(
			'the GraphQL query is rejected with the message:',
			(docString: string) => {
				expect(update.response!.statusCode).toEqual(400);

				expect(update.response!.body.errors[0].extensions.code)
					.toEqual('GRAPHQL_VALIDATION');

				expect(
					update.response!.body.errors[0].extensions.errors[0].message,
				).toEqual(messageOfDocString(docString, (rowName) => {
						return update.rows.find((row) => row.name === rowName)!.id;
					}));
			},
		);

		then.optional(
			"the collection's update references the OnRepeatedPk parameter",
			() => {
				const specDocument = update.response!.body;

				expect(specDocument.paths[`/items/${update.collection}`].patch.parameters)
					.toEqual([
						{ $ref: '#/components/parameters/Fields' },
						{ $ref: '#/components/parameters/Limit' },
						{ $ref: '#/components/parameters/Meta' },
						{ $ref: '#/components/parameters/Offset' },
						{ $ref: '#/components/parameters/Sort' },
						{ $ref: '#/components/parameters/Filter' },
						{ $ref: '#/components/parameters/Search' },
						{ $ref: '#/components/parameters/OnRepeatedPk' },
					]);
			},
		);

		and.optional('the OAS describes the OnRepeatedPk parameter', () => {
			expect(update.response!.body.components.parameters.OnRepeatedPk)
				.toEqual({
					name: 'onRepeatedPk',
					// The spec's folded scalar keeps its last line break.
					description: `${oneLine`
						What the update does with a row it is sent more than once.
						\`refuse\` refuses the update before any hook runs, and refuses a
						hook answering with a row twice; a row sent twice in one change
						is written once. \`lastWins\` writes every change in the order
						sent.
					`}\n`,
					in: 'query',
					required: false,
					schema: {
						type: 'string',
						enum: ['refuse', 'lastWins'],
						default: 'refuse',
					},
				});
		});

		and.optional(/^the refusal's code is "(.*)"$/, (code: string) => {
			expect(update.response!.body.errors[0].extensions.code).toEqual(code);
		});

		and.optional('the rows hold:', async (table: Record<string, string>[]) => {
			const response = await request(getUrl(vendor))
				.get(`/items/${update.collection}`)
				.query({
					'filter[id][_in]': update.rows.map((row) => row.id).join(','),
					fields: 'name,status',
					sort: 'id',
				})
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
			expect(response.body.data).toEqual(parseGherkinTable(table));
		});

		and.optional('the slots hold:', async (table: Record<string, string>[]) => {
			const response = await request(getUrl(vendor))
				.get(`/items/${update.collection}`)
				.query({
					'filter[id][_in]': update.rows.map((row) => row.id).join(','),
					fields: 'name,holder,slot',
					sort: 'id',
				})
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
			expect(response.body.data).toEqual(parseGherkinTable(table));
		});

		and.optional('the labels hold:', async (table: Record<string, string>[]) => {
			const response = await request(getUrl(vendor))
				.get(`/items/${update.collection}`)
				.query({
					'filter[id][_in]': update.rows.map((row) => row.id).join(','),
					fields: 'name,label',
					sort: 'id',
				})
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
			expect(response.body.data).toEqual(parseGherkinTable(table));
		});

		and.optional(
			'the update events are:',
			async (table: Record<string, string>[]) => {
				const eventCounts = await Promise.all(table.map(async ({ event, phase }) => {
					return {
						event,
						phase,
						count: (await readLoggedPayloads(event!, phase!)).length,
					};
				}));

				expect(eventCounts).toEqual(parseGherkinTable(table));
			},
		);

		// The other scenarios show the probe logs, so an empty log means something.
		and.optional('no update event was logged', async () => {
			expect([
				...await readLoggedPayloads('items.update', 'filter'),
				...await readLoggedPayloads('items.update', 'action'),
			]).toEqual([]);
		});

		and.optional(
			/^the rows point at the one owner named "(.*)"$/,
			async (ownerName: string) => {
				const ownersResponse = await request(getUrl(vendor))
					.get(`/items/${collectionGroupedOwner}`)
					.query({ 'filter[name][_eq]': ownerName, fields: 'id' })
					.set('Authorization', AUTH);

				expect(ownersResponse.body.data).toEqual([
					{ id: expect.any(Number) },
				]);

				const ownerId = ownersResponse.body.data[0].id;

				const rowsResponse = await request(getUrl(vendor))
					.get(`/items/${collectionGrouped}`)
					.query({
						'filter[id][_in]': update.rows.map((row) => row.id).join(','),
						fields: 'owner',
						sort: 'id',
					})
					.set('Authorization', AUTH);

				expect(rowsResponse.body.data).toEqual([
					{ owner: ownerId },
					{ owner: ownerId },
				]);
			},
		);

		and.optional('the users hold:', async (table: Record<string, string>[]) => {
			const response = await request(getUrl(vendor))
				.get('/users')
				.query({
					'filter[id][_in]': update.rows.map((row) => row.id).join(','),
					fields: 'first_name,status',
				})
				.set('Authorization', AUTH);

			expect(response.statusCode).toEqual(200);
			expect(response.body.data).toEqual(parseGherkinTable(table));
		});

		// One revision per row written, in the order the rows were written.
		and.optional(
			'the revisions name the rows in this order:',
			async (table: Record<string, string>[]) => {
				const response = await request(getUrl(vendor))
					.get('/revisions')
					.query({
						'filter[collection][_eq]': update.collection,
						'filter[item][_in]': update.rows.map((row) => row.id).join(','),
						// The rows' create left a revision each too.
						'filter[activity][action][_eq]': 'update',
						fields: 'item',
						sort: 'id',
					})
					.set('Authorization', AUTH);

				expect(response.statusCode).toEqual(200);

				expect(namesOf(
					update,
					response.body.data.map((revision: { item: string }) => {
						return Number(revision.item);
					}),
				)).toEqual(
					parseGherkinTable<{ name: string }>(table).map((row) => row.name),
				);
			},
		);
	}

	defineFeature(feature, (scenario) => {
		for (const title of [
			'an update fires the grouped event once',
			'a batch where every row writes nothing answers with every row',
			'a batch answers with every row it was sent, no-op rows included',
			'rows side by side carrying the same change are written together',
			oneLine`
				rows apart carrying the same change are written in the order sent
			`,
			'a batch writes its revisions in the order it sends its rows',
			oneLine`
				a batch hands a slot over when a row frees it before the next takes
				it
			`,
			oneLine`
				a batch hands a slot over to a row stored before the one freeing it
			`,
			oneLine`
				a batch taking a slot its holder still holds is refused, writing
				nothing
			`,
			'a batch naming an owner that does not exist is refused',
			'rows side by side changing different fields are each written',
			oneLine`
				a row a batch changes back and forth keeps the last change it was
				sent
			`,
			oneLine`
				a row a non-admin sends twice with one change is checked and written
				once
			`,
			oneLine`
				a batch sending a row twice is refused before any update hook runs
			`,
			oneLine`
				a batch passing an unknown onRepeatedPk is refused before any hook
			`,
			'a batch sending a uuid twice, once in capitals, is refused',
			oneLine`
				a batch sending a row twice, once with a leading zero, is refused
			`,
			oneLine`
				a GraphQL batch sending a row twice is refused before any hook
			`,
			oneLine`
				a GraphQL batch passing onRepeatedPk lastWins keeps the last
				change
			`,
			'a GraphQL batch passing an unknown onRepeatedPk is refused',
			oneLine`
				the OAS describes onRepeatedPk on a collection's batch update
			`,
			'a row sent twice under one change reaches the hooks once',
			oneLine`
				a grouped hook answering with a row twice is refused, writing
				nothing
			`,
			oneLine`
				a grouped hook answering with one payload is refused, naming the
				helper
			`,
			oneLine`
				a grouped hook dropping a key cancels that row, its sibling
				written
			`,
			oneLine`
				a grouped hook deleting a field off the list is refused, writing
				nothing
			`,
			oneLine`
				a grouped hook reading a field off the list is refused, writing
				nothing
			`,
			'a malformed key is refused before any update hook runs',
			'an update naming no row runs no update hook',
			'a batch no update hook listens to is written as it was sent',
			oneLine`
				a hook mapping its rows cancels one, its siblings written together
			`,
			'a hook mapping its rows splits off the one it rewrote',
			oneLine`
				a hook mapping its rows takes one over, Directus writing the others
			`,
			'a nested owner sent to several rows a hook maps is created once',
			'a row a hook adds to an update is written, left out of the answer',
			'a users batch sending a user twice is refused, no onRepeatedPk to pass',
			oneLine`
				a GraphQL users batch sending a user twice is refused, naming no
				option
			`,
			'a GraphQL users batch passing onRepeatedPk is rejected',
		]) {
			scenario(title, (steps) => {
				defineSteps(steps, {
					collection: collectionGrouped,
					rows: [],
					malformedKey: 'not-a-key',
					authorization: AUTH,
				});
			}, 60_000);
		}
	});
});
