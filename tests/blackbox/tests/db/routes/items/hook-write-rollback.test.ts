import { getUrl } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { USER } from '@common/variables';
import request, { type Response } from 'supertest';
import { describe, expect } from 'vitest';

const feature = loadFeature('./tests/db/routes/items/hook-write-rollback.feature');

describe.each(vendors)('%s', (vendor) => {
	const adminAuth = `Bearer ${USER.ADMIN.TOKEN}`;

	type Mutation = {
		collectionPrefix: string;
		itemId: number;
		witnessId: number;
		response: Response | null;
	};

	defineFeature(feature, (scenario) => {
		for (const scenarioTitle of [
			'an update the service refuses takes its hook\'s write back',
			'an update the service accepts keeps its hook\'s write',
			'a delete the access check refuses takes its hook\'s write back',
			'a delete the service accepts keeps its hook\'s write',
		]) {
			scenario(scenarioTitle, ({ given, when, then, and }) => {
				const mutation: Mutation = {
					collectionPrefix: '',
					itemId: 0,
					witnessId: 0,
					response: null,
				};

				given(
					/^the item (\d+) and its witness in (\w+)$/,
					async (itemId: string, collectionPrefix: string) => {
						mutation.collectionPrefix = collectionPrefix;
						mutation.itemId = Number(itemId);

						const item = await request(getUrl(vendor))
							.post(`/items/${collectionPrefix}_item`)
							.send({ id: mutation.itemId, status: 'draft' })
							.set('Authorization', adminAuth);

						expect(item.statusCode).toEqual(200);

						const witness = await request(getUrl(vendor))
							.post(`/items/${collectionPrefix}_witness`)
							.send({ item: mutation.itemId, note: 'untouched' })
							.set('Authorization', adminAuth);

						expect(witness.statusCode).toEqual(200);
						mutation.witnessId = witness.body.data.id;
					},
				);

				when.optional(
					/^the item is updated to the status "([\w-]+)"$/,
					async (status: string) => {
						mutation.response = await request(getUrl(vendor))
							.patch(`/items/${mutation.collectionPrefix}_item/${mutation.itemId}`)
							.send({ status })
							.set('Authorization', adminAuth);
					},
				);

				when.optional('the item is deleted', async () => {
					mutation.response = await request(getUrl(vendor))
						.delete(`/items/${mutation.collectionPrefix}_item/${mutation.itemId}`)
						.set('Authorization', adminAuth);
				});

				when.optional('a user with no role deletes the item', async () => {
					mutation.response = await request(getUrl(vendor))
						.delete(`/items/${mutation.collectionPrefix}_item/${mutation.itemId}`)
						.set('Authorization', `Bearer ${USER.NO_ROLE.TOKEN}`);
				});

				then.optional(
					/^the mutation is refused with the status (\d+) and the message:$/,
					(status: string, docString: string) => {
						expect(mutation.response!.statusCode).toEqual(Number(status));

						expect(mutation.response!.body.errors[0].message)
							.toEqual(docString);
					},
				);

				then.optional(/^the mutation answers (\d+)$/, (status: string) => {
					expect(mutation.response!.statusCode).toEqual(Number(status));
				});

				and(
					/^the witness holds the note "([\w-]+)"$/,
					async (note: string) => {
						const witness = await request(getUrl(vendor))
							.get(
								`/items/${mutation.collectionPrefix}_witness/${mutation.witnessId}`,
							)
							.query({ fields: 'note' })
							.set('Authorization', adminAuth);

						expect(witness.statusCode).toEqual(200);
						expect(witness.body.data).toEqual({ note });
					},
				);
			});
		}
	});
});
