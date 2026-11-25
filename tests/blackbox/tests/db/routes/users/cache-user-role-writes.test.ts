import {
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { USER } from '@common/variables';
import request from 'supertest';
import { expect } from 'vitest';
import { defineSpawnedWriteFeature } from '../system/spawned-write-steps';

const COLLECTIONS = [
	'cache_user_rename_notes',
	'cache_user_activate_notes',
	'cache_user_delete_notes',
	'cache_user_accept_notes',
	'cache_user_reinvite_notes',
	'cache_user_again_notes',
	'cache_user_second_notes',
];

defineSpawnedWriteFeature(
	'./tests/db/routes/users/cache-user-role-writes.feature',
	{
		envOverrides: {
			CACHE_ENABLED: 'true',
			CACHE_STATUS_HEADER: 'x-cache-status',
			CACHE_PURGED_TAGS_HEADER: 'x-scoped-cache-purged-tags',
			CACHE_AUTO_PURGE: 'true',
			CACHE_AUTO_PURGE_MODE: 'scoped',
			CACHE_STORE: 'redis',
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
			CACHE_NAMESPACE: 'directus-cache-user-role-writes',
		},
		// Created through the feature's own instance, so its schema holds them.
		async beforeFeature(vendor, instanceUrl) {
			for (const collection of COLLECTIONS) {
				await DeleteCollectionIfPresent(vendor, { collection });

				const response = await request(instanceUrl)
					.post('/collections')
					.send({
						collection,
						schema: {},
						meta: {},
						fields: [{ field: 'label', type: 'string', meta: {} }],
					})
					.set('Authorization', `Bearer ${USER.ADMIN.TOKEN}`);

				expect(response.statusCode).toEqual(200);
			}
		},
		async afterFeature(vendor) {
			for (const collection of COLLECTIONS) {
				await DeleteCollection(vendor, { collection });
			}
		},
	},
);
