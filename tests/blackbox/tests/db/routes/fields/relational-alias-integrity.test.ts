import { defineSpawnedWriteFeature } from '../system/spawned-write-steps';

defineSpawnedWriteFeature(
	'./tests/db/routes/fields/relational-alias-integrity.feature',
	{ envOverrides: {} },
);
