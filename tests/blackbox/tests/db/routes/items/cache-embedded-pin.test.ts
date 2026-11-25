import { defineSpawnedWriteFeature } from '../system/spawned-write-steps';

defineSpawnedWriteFeature(
	'./tests/db/routes/items/cache-embedded-pin.feature',
	{
		envOverrides: {
			CACHE_ENABLED: 'true',
			CACHE_STATUS_HEADER: 'x-cache-status',
			CACHE_TAGS_HEADER: 'x-scoped-cache-tags',
			CACHE_AUTO_PURGE: 'true',
			CACHE_AUTO_PURGE_MODE: 'scoped',
			CACHE_STORE: 'redis',
			REDIS_HOST: 'localhost',
			REDIS_PORT: '6108',
			CACHE_NAMESPACE: 'directus-cache-embedded-pin',
		},
	},
);
