import { getUrl } from '@common/config';
import { defineFeature, loadFeature, parseGherkinTable } from '@common/cucumber';
import { CreateItem } from '@common/functions';
import vendors from '@common/get-dbs-to-test';
import { createWebSocketConn } from '@common/transport';
import { USER } from '@common/variables';
import request from 'supertest';
import { describe, expect } from 'vitest';
import { collectionBatchUpdate } from './batch-update.seed';

type BatchRow = { id: number; name: string };

const feature = loadFeature('./tests/db/websocket/batch-update.feature');

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		scenario(
			'a batch carrying two changes reaches a subscriber as one message',
			({ given, and, when, then }) => {
				let rows: BatchRow[] = [];
				let ws: ReturnType<typeof createWebSocketConn>;

				given('the rows:', async (table: Record<string, string>[]) => {
					rows = await CreateItem(vendor, {
						collection: collectionBatchUpdate,
						item: parseGherkinTable<{ name: string }>(table),
					});
				});

				and('a websocket subscriber to the rows', async () => {
					ws = createWebSocketConn(getUrl(vendor), {
						auth: { access_token: USER.ADMIN.TOKEN },
					});

					await ws.subscribe({
						collection: collectionBatchUpdate,
						event: 'update',
						query: { fields: ['name', 'status'], sort: ['id'] },
					});
				});

				when('the batch sends:', async (table: Record<string, string>[]) => {
					const response = await request(getUrl(vendor))
						.patch(`/items/${collectionBatchUpdate}`)
						.send(parseGherkinTable<{ name: string; status: string }>(table)
							.map((change) => {
								return {
									id: rows.find((row) => row.name === change.name)!.id,
									status: change.status,
								};
							}))
						.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

					expect(response.statusCode).toEqual(200);
				});

				// One message per group, or per row, would hold only part of the batch.
				then(
					'the subscriber\'s first update message holds:',
					async (table: Record<string, string>[]) => {
						const messages = await ws.getMessages(1);

						ws.conn.close();

						expect(messages![0]).toMatchObject({
							type: 'subscription',
							event: 'update',
							data: parseGherkinTable(table),
						});
					},
				);
			},
			60_000,
		);
	});
});
