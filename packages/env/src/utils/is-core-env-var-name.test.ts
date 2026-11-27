import { expect, test } from 'vitest';
import { isCoreEnvVarName } from './is-core-env-var-name.js';

test.each([
	['CACHE_TTL', true],
	['DB_CONNECTION_REPLICA_PORT', true],
	['AUTH_PROVIDERS', true],
	['KEY', true],
	['WEBSOCKETS_LOGS_LEVEL', true],
	['NODE_ENV', true],
	['PROJECT_NAME', true],
	['EXTENSIONS_PATH', true],
	['RAILWAY_REPLICA_ID', true],
	['WEBSOCKETS_REST_CONN_LIMIT', true],
	['AUTH_GOOGLE_MODE', true],
	['AUTH_GOOGLE_LOGIN_TIMEOUT', true],
	['STORAGE_S3_BUCKET', true],
	['AUTH_SAML_IDP_METADATA', true],
	['DB_SSL__CA', true],
	['CACHE_TTLL', false],
	['WEBSOCKETS_ENABLD', false],
	['SUBSCRIPTIONS_TRIAL_DAYS', false],
])('%s is core\'s: %s', (envVarName, isCoreName) => {
	expect(isCoreEnvVarName(envVarName)).toBe(isCoreName);
});
