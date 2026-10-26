import { getUrl } from '@common/config';
import {
	defineFeature,
	loadFeature,
	messageOfDocString,
} from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request, { type Response } from 'supertest';
import { describe, expect } from 'vitest';

const feature = loadFeature('./tests/db/routes/items/items-written-hooks.feature');

describe.each(vendors)('%s', (vendor) => {
	const adminAuth = `Bearer ${USER.ADMIN.TOKEN}`;

	type Mutation = {
		collectionPrefix: string;
		response: Response | null;
	};

	defineFeature(feature, (scenario) => {
		for (const scenarioTitle of [
			'a create hands the created hook the row it wrote',
			'a create hands the created hook its nested children already written',
			'a created hook that throws takes the create back',
			'a created hook answering other rows is refused',
			'an update hands the updated hook the row it wrote',
			'an updated hook that throws takes the update back',
		]) {
			scenario(scenarioTitle, ({ given, when, then, and }) => {
				const mutation: Mutation = {
					collectionPrefix: '',
					response: null,
				};

				given(
					/^the collections of (\w+)$/,
					(collectionPrefix: string) => {
						mutation.collectionPrefix = collectionPrefix;
					},
				);

				and.optional(
					/^the item (\d+) with the status "([\w-]+)"$/,
					async (itemId: string, status: string) => {
						const item = await request(getUrl(vendor))
							.post(`/items/${mutation.collectionPrefix}_item`)
							.send({ id: Number(itemId), status })
							.set('Authorization', adminAuth);

						expect(item.statusCode).toEqual(200);
					},
				);

				when.optional(
					/^the item (\d+) is created with the status "([\w-]+)"$/,
					async (itemId: string, status: string) => {
						mutation.response = await request(getUrl(vendor))
							.post(`/items/${mutation.collectionPrefix}_item`)
							.send({ id: Number(itemId), status })
							.set('Authorization', adminAuth);
					},
				);

				when.optional(
					/^the item (\d+) is created with the status "([\w-]+)" and (\d+) children$/,
					async (itemId: string, status: string, childCount: string) => {
						mutation.response = await request(getUrl(vendor))
							.post(`/items/${mutation.collectionPrefix}_item`)
							.send({
								id: Number(itemId),
								status,
								children: Array.from(
									{ length: Number(childCount) },
									(_unused, index) => ({ name: `child-${index}` }),
								),
							})
							.set('Authorization', adminAuth);
					},
				);

				when.optional(
					/^the item (\d+) is updated to the status "([\w-]+)"$/,
					async (itemId: string, status: string) => {
						mutation.response = await request(getUrl(vendor))
							.patch(`/items/${mutation.collectionPrefix}_item/${itemId}`)
							.send({ status })
							.set('Authorization', adminAuth);
					},
				);

				then.optional(
					/^the mutation is refused with the status (\d+) and the message:$/,
					(status: string, docString: string) => {
						expect(mutation.response!.statusCode).toEqual(Number(status));

						expect(mutation.response!.body.errors[0].message)
							.toEqual(messageOfDocString(docString));
					},
				);

				then.optional(/^the mutation answers (\d+)$/, (status: string) => {
					expect(mutation.response!.statusCode).toEqual(Number(status));
				});

				and.optional(/^the item (\d+) does not exist$/, async (itemId: string) => {
					const items = await request(getUrl(vendor))
						.get(`/items/${mutation.collectionPrefix}_item`)
						.query({ filter: { id: { _eq: Number(itemId) } }, fields: 'id' })
						.set('Authorization', adminAuth);

					expect(items.statusCode).toEqual(200);
					expect(items.body.data).toEqual([]);
				});

				and.optional(
					/^the item (\d+) holds the status "([\w-]+)"$/,
					async (itemId: string, status: string) => {
						const item = await request(getUrl(vendor))
							.get(`/items/${mutation.collectionPrefix}_item/${itemId}`)
							.query({ fields: 'status' })
							.set('Authorization', adminAuth);

						expect(item.statusCode).toEqual(200);
						expect(item.body.data).toEqual({ status });
					},
				);

				and.optional(
					/^the witness of the item (\d+) holds the notes "([\w:, -]+)"$/,
					async (itemId: string, notes: string) => {
						const witness = await request(getUrl(vendor))
							.get(`/items/${mutation.collectionPrefix}_witness`)
							.query({
								filter: { item: { _eq: Number(itemId) } },
								fields: 'note',
								sort: 'id',
							})
							.set('Authorization', adminAuth);

						expect(witness.statusCode).toEqual(200);

						expect(witness.body.data).toEqual(
							notes.split(', ').map((note) => ({ note })),
						);
					},
				);

				and.optional(
					/^the witness of the item (\d+) holds no note$/,
					async (itemId: string) => {
						const witness = await request(getUrl(vendor))
							.get(`/items/${mutation.collectionPrefix}_witness`)
							.query({ filter: { item: { _eq: Number(itemId) } }, fields: 'note' })
							.set('Authorization', adminAuth);

						expect(witness.statusCode).toEqual(200);
						expect(witness.body.data).toEqual([]);
					},
				);
			});
		}
	});
});
