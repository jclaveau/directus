import { getUrl } from '@common/config';
import {
	defineFeature,
	loadFeature,
	parseGherkinTable,
	type StepFunctions,
} from '@common/cucumber';
import { CreateItem } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import { oneLine } from '@directus/utils';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { describe, expect } from 'vitest';
import { collectionGrouped, collectionGroupedLog } from './update-groups.seed';

type GroupedRow = { id: number; name: string; status: string | null };
type UpdateGroupLogged = { data: { status?: string }; keys: number[] };
type RowLogged = { id: number; status?: string };

type Update = {
	rows: GroupedRow[];
	malformedKey: string;
	response?: request.Response;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const feature = loadFeature(
	'./tests/db/routes/items/update-groups.feature',
);

describe.each(vendors)('%s', (vendor) => {
	// The log is shared by every scenario, and is never cleared: a step reads back
	// only the entries naming its own rows.
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

		when.optional('the batch sends:', async (table: Record<string, string>[]) => {
			update.response = await request(getUrl(vendor))
				.patch(`/items/${collectionGrouped}`)
				.query({ fields: 'name,status', sort: 'id' })
				.send(parseGherkinTable<{ name: string; status: string | null }>(
					table,
				).map((change) => {
					const id = update.rows.find((row) => row.name === change.name)!.id;

					return change.status === null
						? { id }
						: { id, status: change.status };
				}))
				.set('Authorization', AUTH);
		});

		when.optional(
			/^the rows are updated to the status "(.*)"$/,
			async (status: string) => {
				update.response = await request(getUrl(vendor))
					.patch(`/items/${collectionGrouped}`)
					.send({ keys: update.rows.map((row) => row.id), data: { status } })
					.set('Authorization', AUTH);
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

				const ownKeys = update.rows.map((row) => row.id);

				// Every grouped event naming one of these rows, so a second one fails
				// the comparison.
				const ownEvents: UpdateGroupLogged[][] = (
					await readLoggedPayloads('items.update', phase)
				)
					.map((payload: string) => JSON.parse(payload))
					.filter((logged: UpdateGroupLogged[]) => {
						return logged.some((group) => {
							return group.keys.some((key) => ownKeys.includes(key));
						});
					});

				expect(ownEvents.map((groups) => {
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
			/^the update is refused with a reason naming "(.*)"$/,
			(reason: string) => {
				expect(update.response!.statusCode).toEqual(400);
				expect(update.response!.body.errors[0].message).toContain(reason);
			},
		);

		and.optional(/^the refusal's code is "(.*)"$/, (code: string) => {
			expect(update.response!.body.errors[0].extensions.code).toEqual(code);
		});

		and.optional('the rows hold:', async (table: Record<string, string>[]) => {
			const response = await request(getUrl(vendor))
				.get(`/items/${collectionGrouped}`)
				.query({
					'filter[id][_in]': update.rows.map((row) => row.id).join(','),
					fields: 'name,status',
					sort: 'id',
				})
				.set('Authorization', AUTH);

			expect(response.body.data).toEqual(parseGherkinTable(table));
		});

		// A grouped payload names a row in a group's keys, a per-row one in its id.
		and.optional(
			'the update events naming these rows are:',
			async (table: Record<string, string>[]) => {
				const ownKeys = update.rows.map((row) => row.id);

				const counts = await Promise.all(table.map(async ({ event, phase }) => {
					const payloads: (UpdateGroupLogged[] | RowLogged)[] = (
						await readLoggedPayloads(event!, phase!)
					).map((payload: string) => JSON.parse(payload));

					return {
						event,
						phase,
						count: payloads.filter((payload) => {
							return Array.isArray(payload)
								? payload.some((group) => {
									return group.keys.some((key) => ownKeys.includes(key));
								})
								: ownKeys.includes(payload.id);
						}).length,
					};
				}));

				expect(counts).toEqual(parseGherkinTable(table));
			},
		);

		// The per-row actions run together, so their log order is not theirs.
		and.optional(
			'the per-row action names, in any order:',
			async (table: Record<string, string>[]) => {
				const ownKeys = update.rows.map((row) => row.id);

				const actedKeys = (await readLoggedPayloads('items.update.one', 'action'))
					.map((payload: string) => (JSON.parse(payload) as RowLogged).id)
					.filter((key: number) => ownKeys.includes(key));

				expect(namesOf(update, actedKeys).sort()).toEqual(
					parseGherkinTable<{ name: string }>(table)
						.map((row) => row.name)
						.sort(),
				);
			},
		);

		// The probe's earlier entries show it logs, so an empty match means
		// something.
		and.optional('no update event names the malformed key', async () => {
			const payloads = [
				...await readLoggedPayloads('items.update', 'filter'),
				...await readLoggedPayloads('items.update.one', 'filter'),
			];

			expect(payloads.length).toBeGreaterThan(0);

			expect(payloads.filter((payload: string) => {
				return payload.includes(update.malformedKey);
			})).toEqual([]);
		});
	}

	defineFeature(feature, (scenario) => {
		for (const title of [
			'an update fires the grouped event once, then the per-row one per row',
			'a batch where every row writes nothing answers with every row',
			'a batch answers with every row it was sent, no-op rows included',
			'rows carrying the same change are written together, however far apart',
			oneLine`
				a grouped hook answering with one payload is refused, naming the
				per-row event
			`,
			'a grouped hook dropping a key is refused, naming the per-row event',
			oneLine`
				a grouped hook deleting a field off the list is refused, writing
				nothing
			`,
			oneLine`
				a grouped hook reading a field off the list is refused, writing
				nothing
			`,
			'a malformed key is refused before any update hook runs',
			'a per-row hook cancels its row and its siblings are written',
			oneLine`
				a per-row hook rewriting one row splits its group, the rewrite
				written
			`,
		]) {
			scenario(title, (steps) => {
				defineSteps(steps, { rows: [], malformedKey: `not-a-key-${randomUUID()}` });
			}, 60_000);
		}
	});
});
