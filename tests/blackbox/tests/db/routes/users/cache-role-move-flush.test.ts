import {
	DeleteCollection,
	DeleteCollectionIfPresent,
} from '@common/functions';
import { defineSpawnedWriteFeature } from '../system/spawned-write-steps';

const NOTES = 'cache_role_move_notes';

defineSpawnedWriteFeature(
	'./tests/db/routes/users/cache-role-move-flush.feature',
	{
		envOverrides: {
			CACHE_ENABLED: 'true',
			CACHE_STATUS_HEADER: 'x-cache-status',
			CACHE_AUTO_PURGE: 'false',
			CACHE_STORE: 'memory',
			CACHE_NAMESPACE: 'directus-cache-role-move-flush',
		},
		async beforeFeature(vendor) {
			await DeleteCollectionIfPresent(vendor, { collection: NOTES });
		},
		async afterFeature(vendor) {
			await DeleteCollection(vendor, { collection: NOTES });
		},
	},
);
