import { useEnv } from '@directus/env';
import { afterEach, expect, test, vi } from 'vitest';
import { isCacheTypeEnabled } from './is-cache-type-enabled.js';

vi.mock('@directus/env');

afterEach(() => {
	vi.clearAllMocks();
});

test('returns true only for a type present in CACHE_TYPES', () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_TYPES: ['api', 'service'] });

	expect(isCacheTypeEnabled('api')).toBe(true);
	expect(isCacheTypeEnabled('service')).toBe(true);
});

test('returns false for a type absent from CACHE_TYPES', () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_TYPES: ['api'] });

	expect(isCacheTypeEnabled('service')).toBe(false);
});

test('returns false when CACHE_TYPES is missing or not an array', () => {
	vi.mocked(useEnv).mockReturnValue({});
	expect(isCacheTypeEnabled('api')).toBe(false);

	vi.mocked(useEnv).mockReturnValue({ CACHE_TYPES: 'api' });
	expect(isCacheTypeEnabled('api')).toBe(false);
});
