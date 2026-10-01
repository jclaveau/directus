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
import { collectionGrouped, collectionGroupedLog } from './batch-update-groups.seed';

type GroupedRow = { id: number; name: string; status: string | null };
type UpdateGroupLogged = { data: { status?: string }; keys: number[] };

type Update = {
	rows: GroupedRow[];
	malformedKey: string;
	response?: request.Response;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const feature = loadFeature(
	'./tests/db/routes/items/update-groups-guards.feature',
);

describe.each(vendors)('%s', (vendor) => {
	// batch-update-groups.test.ts clears the log the probe writes into, so these
	// steps never do: they read back only the entries naming their own rows.
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

	function namesOf(update: Update, keys: number[]) {
		return keys.map((key) => {
			return update.rows.find((row) => row.id === key)!.name;
		});
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

		when.optional('the batch sends each row its key alone', async () => {
			update.response = await request(getUrl(vendor))
				.patch(`/items/${collectionGrouped}`)
				.query({ fields: 'name,status', sort: 'id' })
				.send(update.rows.map((row) => ({ id: row.id })))
				.set('Authorization', AUTH);
		});

		when.optional('the batch sends:', async (table: Record<string, string>[]) => {
			const changes = parseGherkinTable<{ name: string; status: string }>(table);

			update.response = await request(getUrl(vendor))
				.patch(`/items/${collectionGrouped}`)
				.send(changes.map((change) => {
					return {
						id: update.rows.find((row) => row.name === change.name)!.id,
						status: change.status,
					};
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

		then.optional('the update answers:', (table: Record<string, string>[]) => {
			expect(update.response!.statusCode).toEqual(200);
			expect(update.response!.body.data).toEqual(parseGherkinTable(table));
		});

		then.optional(
			'the grouped action carries:',
			async (table: Record<string, string>[]) => {
				expect(update.response!.statusCode).toEqual(200);

				const ownKeys = update.rows.map((row) => row.id);

				const groups: UpdateGroupLogged[] = (
					await readLoggedPayloads('items.update', 'action')
				)
					.map((payload: string) => JSON.parse(payload))
					.find((logged: UpdateGroupLogged[]) => {
						return logged.some((group) => ownKeys.includes(group.keys[0]!));
					});

				expect(groups.map((group) => {
					return {
						status: group.data.status,
						names: namesOf(update, group.keys),
					};
				})).toEqual(parseGherkinTable(table));
			},
		);

		then.optional(
			/^the update is refused with a reason naming "(.*)"$/,
			(reason: string) => {
				expect(update.response!.statusCode).toEqual(400);
				expect(update.response!.body.errors[0].message).toContain(reason);
			},
		);

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

		and.optional('no update event names the malformed key', async () => {
			const payloads = [
				...await readLoggedPayloads('items.update', 'filter'),
				...await readLoggedPayloads('items.update.one', 'filter'),
			];

			expect(payloads.filter((payload: string) => {
				return payload.includes(update.malformedKey);
			})).toEqual([]);
		});
	}

	defineFeature(feature, (scenario) => {
		for (const title of [
			'a batch where every row writes nothing answers with every row',
			'rows carrying the same change are written together, however far apart',
			oneLine`
				a grouped hook answering with one payload is refused, naming the
				per-row event
			`,
			'a malformed key is refused before any update hook runs',
		]) {
			scenario(title, (steps) => {
				defineSteps(steps, { rows: [], malformedKey: `not-a-key-${randomUUID()}` });
			}, 60_000);
		}
	});
});
