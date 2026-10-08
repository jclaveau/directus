import { getUrl } from '@common/config';
import { defineFeature, loadFeature } from '@common/cucumber';
import vendors from '@common/get-dbs-to-test';
import { createWebSocketConn } from '@common/transport';
import { USER } from '@common/variables';
import { load as loadYaml } from 'js-yaml';
import request from 'supertest';
import { describe, expect } from 'vitest';
import { collectionRelationArticles } from './relation-update.seed';

const feature = loadFeature('./tests/db/websocket/relation-update.feature');

describe.each(vendors)('%s', (vendor) => {
	defineFeature(feature, (scenario) => {
		scenario(
			'a relation update sends the subscriber the meta it changed',
			({ given, when, then }) => {
				let ws: ReturnType<typeof createWebSocketConn>;

				given('a websocket subscriber to the relation updates', async () => {
					ws = createWebSocketConn(getUrl(vendor), {
						auth: { access_token: USER.ADMIN.TOKEN },
					});

					await ws.subscribe({
						collection: 'directus_relations',
						event: 'update',
					});
				});

				when(
					'the relation\'s meta is patched with:',
					async (relationMeta: string) => {
						const response = await request(getUrl(vendor))
							.patch(`/relations/${collectionRelationArticles}/author`)
							.send({ meta: loadYaml(relationMeta) })
							.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

						expect(response.statusCode).toEqual(200);
					},
				);

				then(
					'the subscriber\'s first update message is:',
					async (expectedMessage: string) => {
						const messages = await ws.getMessages(1);

						ws.conn.close();

						expect(messages![0]).toEqual(loadYaml(expectedMessage));
					},
				);
			},
			60_000,
		);
	});
});
