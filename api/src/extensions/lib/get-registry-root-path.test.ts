import { afterEach, expect, test, vi } from 'vitest';

const envRef = vi.hoisted(() => {
	return {
		current: {} as Record<string, unknown>,
	};
});

vi.mock('@directus/env', () => ({ useEnv: () => envRef.current }));

import { getRegistryRootPath } from './get-registry-root-path.js';

afterEach(() => {
	envRef.current = {};
});

test('reads the registry from ./extensions without a storage location', () => {
	expect(getRegistryRootPath()).toBe('./extensions');
});

test('reads the registry from TEMP_PATH when synced from a storage location', () => {
	envRef.current = {
		EXTENSIONS_LOCATION: 'remote',
		TEMP_PATH: '/tmp/directus',
	};

	expect(getRegistryRootPath()).toBe('/tmp/directus/extensions');
});
