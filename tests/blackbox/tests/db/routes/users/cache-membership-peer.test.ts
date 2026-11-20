import {
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect } from 'vitest';
import { defineSpawnedWriteFeature } from '../system/spawned-write-steps';

defineSpawnedWriteFeature(
	'./tests/db/routes/users/cache-membership-peer.feature',
	{
		envOverrides: {
			CACHE_ENABLED: 'true',
			CACHE_STATUS_HEADER: 'x-cache-status',
			CACHE_AUTO_PURGE: 'true',
			CACHE_STORE: 'memory',
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
			CACHE_NAMESPACE: 'directus-cache-membership-peer',
		},
		spawnsPeer: true,
		// Created through the feature's own instance, so its schema holds it.
		async beforeFeature(vendor, instanceUrl) {
			await DeleteCollectionIfPresent(vendor, {
				collection: 'cache_membership_peer_notes',
			});

			const response = await request(instanceUrl)
				.post('/collections')
				.send({
					collection: 'cache_membership_peer_notes',
					schema: {},
					meta: {},
					fields: [{ field: 'label', type: 'string', meta: {} }],
				})
				.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

			expect(response.statusCode).toEqual(200);
		},
		async afterFeature(vendor) {
			await DeleteCollection(vendor, {
				collection: 'cache_membership_peer_notes',
			});
		},
	},
);
