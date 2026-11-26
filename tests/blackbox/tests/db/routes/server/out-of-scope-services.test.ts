import { defineSpawnedWriteFeature } from '../system/spawned-write-steps';

defineSpawnedWriteFeature(
	'./tests/db/routes/server/out-of-scope-services.feature',
	{
		envOverrides: {
			OUT_OF_SCOPE_FEATURES_ALLOWED: 'saml,oauth2,openid,websockets-graphql',
		},
	},
);
