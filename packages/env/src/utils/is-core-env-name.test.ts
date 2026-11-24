import { expect, test } from 'vitest';
import { isCoreEnvName } from './is-core-env-name.js';

test.each([
	['CACHE_TTL', true],
	['DB_CONNECTION_REPLICA_PORT', true],
	['AUTH_PROVIDERS', true],
	['KEY', true],
	['WEBSOCKETS_LOGS_LEVEL', true],
	['CACHE_TTLL', false],
	['WEBSOCKETS_ENABLD', false],
	['SUBSCRIPTIONS_TRIAL_DAYS', false],
])('%s is core\'s: %s', (name, isCore) => {
	expect(isCoreEnvName(name)).toBe(isCore);
});
