import { defineSpawnedWriteFeature } from '../system/spawned-write-steps';

defineSpawnedWriteFeature(
	'./tests/db/routes/files/tus-resumable-upload.feature',
	{ envOverrides: { TUS_ENABLED: 'true' } },
);
