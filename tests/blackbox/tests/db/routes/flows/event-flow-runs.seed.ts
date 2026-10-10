import { getUrl } from '@common/config';
import { CreateCollections, DeleteCollection } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect, it } from 'vitest';

export const collectionFlowRuns = 'test_event_flow_runs';
export const collectionFlowRewrites = 'test_event_flow_rewrites';
export const collectionFlowRefusals = 'test_event_flow_refusals';

// A flow holding `transform` is a filter flow whose `$last` return replaces the
// change it was given.
export const eventFlows = [
	{
		id: '6f6c8a41-3c55-4c0e-9d0b-2b7d1a5e0f01',
		name: 'event-flow-runs update filter',
		collection: collectionFlowRuns,
		options: { type: 'filter', scope: ['items.update'] },
	},
	{
		id: '6f6c8a41-3c55-4c0e-9d0b-2b7d1a5e0f02',
		name: 'event-flow-runs update action',
		collection: collectionFlowRuns,
		options: { type: 'action', scope: ['items.update'] },
	},
	{
		id: '6f6c8a41-3c55-4c0e-9d0b-2b7d1a5e0f03',
		name: 'event-flow-runs create action',
		collection: collectionFlowRuns,
		options: { type: 'action', scope: ['items.create'] },
	},
	{
		id: '6f6c8a41-3c55-4c0e-9d0b-2b7d1a5e0f04',
		name: 'event-flow-runs rewrite filter',
		collection: collectionFlowRewrites,
		options: { type: 'filter', scope: ['items.update'], return: '$last' },
		transform: { status: 'set-by-flow' },
	},
	{
		id: '6f6c8a41-3c55-4c0e-9d0b-2b7d1a5e0f05',
		name: 'event-flow-runs refusal filter',
		collection: collectionFlowRefusals,
		options: { type: 'filter', scope: ['items.update'], return: '$last' },
		transform: null,
	},
	{
		id: '6f6c8a41-3c55-4c0e-9d0b-2b7d1a5e0f06',
		name: 'event-flow-runs users update filter',
		collection: 'directus_users',
		options: { type: 'filter', scope: ['items.update'] },
	},
	{
		id: '6f6c8a41-3c55-4c0e-9d0b-2b7d1a5e0f07',
		name: 'event-flow-runs users update action',
		collection: 'directus_users',
		options: { type: 'action', scope: ['items.update'] },
	},
];

export const seedDBStructure = () => {
	it.each(vendors)(
		'%s',
		async (vendor) => {
			const auth = `Bearer ${USER.TESTS_FLOW.TOKEN}`;

			for (const collection of [
				collectionFlowRuns,
				collectionFlowRewrites,
				collectionFlowRefusals,
			]) {
				await DeleteCollection(vendor, { collection });
			}

			// Deleting a flow deletes its operations.
			await request(getUrl(vendor))
				.delete('/flows')
				.send(eventFlows.map((eventFlow) => eventFlow.id))
				.set('Authorization', auth);

			await CreateCollections(vendor, {
				collections: [
					collectionFlowRuns,
					collectionFlowRewrites,
					collectionFlowRefusals,
				].map((collection) => {
					return {
						collection,
						meta: {},
						fields: [
							{ field: 'name', type: 'string', meta: {} },
							{ field: 'status', type: 'string', meta: {} },
						],
					};
				}),
			});

			// A run with accountability "all" writes a revision holding its $trigger,
			// which is all the test reads back.
			for (const eventFlow of eventFlows) {
				const flowResponse = await request(getUrl(vendor))
					.post('/flows')
					.send({
						id: eventFlow.id,
						name: eventFlow.name,
						status: 'active',
						trigger: 'event',
						accountability: 'all',
						options: {
							...eventFlow.options,
							collections: [eventFlow.collection],
						},
					})
					.set('Authorization', auth);

				expect(flowResponse.statusCode).toEqual(200);
			}

			const transformFlows = eventFlows.filter((eventFlow) => {
				return 'transform' in eventFlow;
			});

			for (const transformFlow of transformFlows) {
				// The operation needs its flow to exist, and the flow then names it as
				// the one it starts with.
				const operationResponse = await request(getUrl(vendor))
					.post('/operations')
					.send({
						name: 'transform',
						key: 'transform',
						type: 'transform',
						position_x: 19,
						position_y: 1,
						options: { json: transformFlow.transform },
						flow: transformFlow.id,
					})
					.query({ fields: 'id' })
					.set('Authorization', auth);

				expect(operationResponse.statusCode).toEqual(200);

				const startResponse = await request(getUrl(vendor))
					.patch(`/flows/${transformFlow.id}`)
					.send({ operation: operationResponse.body.data.id })
					.set('Authorization', auth);

				expect(startResponse.statusCode).toEqual(200);
			}
		},
		300_000,
	);
};
