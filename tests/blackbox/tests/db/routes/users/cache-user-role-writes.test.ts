import {
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { defineSpawnedWriteFeature } from '../system/spawned-write-steps';

const COLLECTIONS = [
	'cache_user_rename_notes',
	'cache_user_activate_notes',
	'cache_user_delete_notes',
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
		async beforeFeature(vendor) {
			for (const collection of COLLECTIONS) {
				await DeleteCollectionIfPresent(vendor, { collection });
			}
		},
		async afterFeature(vendor) {
			for (const collection of COLLECTIONS) {
				await DeleteCollection(vendor, { collection });
			}
		},
	},
);
