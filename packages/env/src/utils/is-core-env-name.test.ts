import { expect, test } from 'vitest';
import { isCoreEnvName } from './is-core-env-name.js';

test.each([
	['CACHE_TTL', true],
	['DB_CONNECTION_REPLICA_PORT', true],
	['AUTH_PROVIDERS', true],
	['KEY', true],
	['CACHE_TTLL', false],
	['SUBSCRIPTIONS_TRIAL_DAYS', false],
])('%s is core\'s: %s', (name, isCore) => {
	expect(isCoreEnvName(name)).toBe(isCore);
});
