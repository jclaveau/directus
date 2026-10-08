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
import { sleep } from '@utils/sleep';
import { randomUUID } from 'crypto';
import request from 'supertest';
import { beforeAll, describe, expect } from 'vitest';
import { collectionFlowRefusals, eventFlows } from './event-flow-runs.seed';

type FlowRow = { id: number | string; name: string };

type FlowTrigger = {
	payload: { status?: string; name?: string };
	keys?: (number | string)[];
	key?: number | string;
};

type Update = {
	rows: FlowRow[];
	path: string;
	response?: request.Response;
};

const AUTH = `Bearer ${USER.ADMIN.TOKEN}`;

const feature = loadFeature('./tests/db/routes/flows/event-flow-runs.feature');

describe.each(vendors)('%s', (vendor) => {
	// The seed wrote the flows through the seed server, and a server registers
	// flows only on a reload of its own, which a write to a flow starts.
	beforeAll(async () => {
		const reload = await request(getUrl(vendor))
			.patch('/flows')
			.send({
				keys: eventFlows.map((eventFlow) => eventFlow.id),
				data: { status: 'active' },
			})
			.set('Authorization', AUTH);

		expect(reload.statusCode).toEqual(200);

		const [probe] = await CreateItem(vendor, {
			collection: collectionFlowRefusals,
			item: [{ name: 'reload-probe' }],
		});

		// The reload lands after the response: the refusal filter refusing the
		// probe is the sign it did.
		for (let attempt = 0; attempt < 100; attempt++) {
			const response = await request(getUrl(vendor))
				.patch(`/items/${collectionFlowRefusals}/${probe.id}`)
				.send({ status: 'probe' })
				.set('Authorization', AUTH);

			if (response.statusCode === 400) {
				return;
			}

			await sleep(100);
		}

		throw new Error('the flows never loaded on this server');
	}, 30_000);

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
				// The seed's writes to the flow left revisions too, holding no $trigger.
				'filter[activity][action][_eq]': 'run',
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

	// A key naming no row of the scenario reads as undefined, failing the step's
	// comparison rather than throwing.
	function namesOf(update: Update, keys: (number | string)[]) {
		const nameByKey = Object.fromEntries(update.rows.map((row) => {
			return [row.id, row.name];
		}));

		return keys.map((key) => nameByKey[key]);
	}

	function defineSteps(
		{ given, when, then, and }: StepFunctions,
		update: Update,
	) {
		given.optional(
			/^the rows of (\w+):$/,
			async (collection: string, table: Record<string, string>[]) => {
				update.path = `/items/${collection}`;

				update.rows = await CreateItem(vendor, {
					collection,
					item: parseGherkinTable<{ name: string }>(table),
				});
			},
		);

		given.optional('the users:', async (table: Record<string, string>[]) => {
			update.path = '/users';

			const response = await request(getUrl(vendor))
				.post('/users')
				.query({ fields: 'id,first_name', sort: 'first_name' })
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
			}) => {
				return { id: user.id, name: user.first_name };
			});
		});

		when.optional('the batch sends:', async (table: Record<string, string>[]) => {
			update.response = await request(getUrl(vendor))
				.patch(update.path)
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
					.patch(update.path)
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
			/^the update is refused with a reason naming "(.*)"$/,
			(reason: string) => {
				expect(update.response!.statusCode).toEqual(400);
				expect(update.response!.body.errors[0].message).toContain(reason);
			},
		);

		then.optional('the rows hold:', async (table: Record<string, string>[]) => {
			const response = await request(getUrl(vendor))
				.get(update.path)
				.query({
					'filter[id][_in]': update.rows.map((row) => row.id).join(','),
					fields: 'name,status',
					sort: 'id',
				})
				.set('Authorization', AUTH);

			expect(response.body.data).toEqual(parseGherkinTable(table));
		});

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
			'a batch runs the update filter once per row, the action once per change',
			'a create runs the create flow once per row',
			'a filter flow\'s return replaces the change it was given',
			'a filter flow returning null refuses the update',
			'an update of several users runs each users update flow once',
		]) {
			scenario(title, (steps) => {
				defineSteps(steps, { rows: [], path: '' });
			}, 60_000);
		}
	});
});
