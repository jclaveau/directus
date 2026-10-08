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
import request from 'supertest';
import { describe, expect } from 'vitest';
import { collectionFlowRuns, eventFlows } from './event-flow-runs.seed';

type FlowRow = { id: number; name: string };

type FlowTrigger = {
	payload: { status?: string; name?: string };
	keys?: number[];
	key?: number;
};

type Update = { rows: FlowRow[]; response?: request.Response };

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const feature = loadFeature('./tests/db/routes/flows/event-flow-runs.feature');

describe.each(vendors)('%s', (vendor) => {
	// Every run of a flow leaves a revision holding its $trigger; the flows are
	// shared by every scenario, so a step keeps only the runs naming its own rows.
	async function readTriggers(flowLabel: string): Promise<FlowTrigger[]> {
		const flowId = eventFlows.find((flow) => {
			return flow.name === `event-flow-runs ${flowLabel}`;
		})!.id;

		const response = await request(getUrl(vendor))
			.get('/revisions')
			.query({
				'filter[collection][_eq]': 'directus_flows',
				'filter[item][_eq]': flowId,
				fields: 'data',
				sort: 'id',
				limit: -1,
			})
			.set('Authorization', AUTH);

		expect(response.statusCode).toEqual(200);

		return response.body.data.map((revision: {
			data: { data: { $trigger: FlowTrigger } };
		}) => revision.data.data.$trigger);
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
		given('the rows:', async (table: Record<string, string>[]) => {
			update.rows = await CreateItem(vendor, {
				collection: collectionFlowRuns,
				item: parseGherkinTable<{ name: string }>(table),
			});
		});

		when.optional('the batch sends:', async (table: Record<string, string>[]) => {
			update.response = await request(getUrl(vendor))
				.patch(`/items/${collectionFlowRuns}`)
				.send(parseGherkinTable<{ name: string; status: string }>(table)
					.map((change) => {
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
					.patch(`/items/${collectionFlowRuns}`)
					.send({ keys: update.rows.map((row) => row.id), data: { status } })
					.set('Authorization', AUTH);
			},
		);

		async function expectUpdateRuns(
			flowLabel: string,
			table: Record<string, string>[],
		) {
			expect(update.response!.statusCode).toEqual(200);

			const ownKeys = update.rows.map((row) => row.id);

			const ownTriggers = (await readTriggers(flowLabel)).filter((trigger) => {
				return trigger.keys!.some((key) => ownKeys.includes(key));
			});

			expect(ownTriggers.map((trigger) => {
				return {
					status: trigger.payload.status,
					names: namesOf(update, trigger.keys!),
				};
			})).toEqual(parseGherkinTable(table));
		}

		then.optional(/^the "(.*)" flow ran with:$/, expectUpdateRuns);
		and.optional(/^the "(.*)" flow ran with:$/, expectUpdateRuns);

		then.optional(
			/^the "(.*)" flow ran once for each of:$/,
			async (flowLabel: string, table: Record<string, string>[]) => {
				const ownKeys = update.rows.map((row) => row.id);

				const ownTriggers = (await readTriggers(flowLabel)).filter((trigger) => {
					return ownKeys.includes(trigger.key!);
				});

				expect(namesOf(update, ownTriggers.map((trigger) => trigger.key!))
					.sort()).toEqual(parseGherkinTable<{ name: string }>(table)
					.map((row) => row.name)
					.sort());
			},
		);
	}

	defineFeature(feature, (scenario) => {
		for (const title of [
			'an update of several rows to one status runs each update flow once',
			'a batch carrying two changes runs each update flow once per change',
			'a create runs the create flow once per row',
		]) {
			scenario(title, (steps) => {
				defineSteps(steps, { rows: [] });
			}, 60_000);
		}
	});
});
