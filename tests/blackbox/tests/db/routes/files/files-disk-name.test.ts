import { defineSpawnedWriteFeature } from '../system/spawned-write-steps';

defineSpawnedWriteFeature(
	'./tests/db/routes/files/files-disk-name.feature',
	{ envOverrides: { TUS_ENABLED: 'true' } },
);
