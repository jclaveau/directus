import { getUrl } from '@common/config';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect, it } from 'vitest';

export const collectionFlowRuns = 'test_event_flow_runs';

// Created at seed time: a flow created mid-test reaches the event bus only once
// its asynchronous reload lands.
export const eventFlows = [
	{
		id: '6f6c8a41-3c55-4c0e-9d0b-2b7d1a5e0f01',
		name: 'event-flow-runs update filter',
		options: { type: 'filter', scope: ['items.update'] },
	},
	{
		id: '6f6c8a41-3c55-4c0e-9d0b-2b7d1a5e0f02',
		name: 'event-flow-runs update action',
		options: { type: 'action', scope: ['items.update'] },
	},
	{
		id: '6f6c8a41-3c55-4c0e-9d0b-2b7d1a5e0f03',
		name: 'event-flow-runs create action',
		options: { type: 'action', scope: ['items.create'] },
	},
];

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			await DeleteCollection(vendor, { collection: collectionFlowRuns });

			await request(getUrl(vendor))
				.delete('/flows')
				.send(eventFlows.map((flow) => flow.id))
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			await CreateCollections(vendor, {
				collections: [
					{
						collection: collectionFlowRuns,
						meta: {},
						fields: [
							{ field: 'name', type: 'string', meta: {} },
							{ field: 'status', type: 'string', meta: {} },
						],
					},
				],
			});

			// No operation: a run with accountability "all" still writes a revision
			// holding its $trigger, which is all the test reads back.
			const response = await request(getUrl(vendor))
				.post('/flows')
				.send(eventFlows.map((flow) => {
					return {
						id: flow.id,
						name: flow.name,
						status: 'active',
						trigger: 'event',
						accountability: 'all',
						options: { ...flow.options, collections: [collectionFlowRuns] },
					};
				}))
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toEqual(200);
		},
		300_000,
	);
};
