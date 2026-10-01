import { useEnv } from '@directus/env';
import { afterEach, expect, test, vi } from 'vitest';
import { cacheAuditEnabled } from './cache-audit-enabled.js';

vi.mock('@directus/env');

afterEach(() => {
	vi.restoreAllMocks();
});

test('is on only when CACHE_AUDIT_ENABLED is the boolean true', () => {
	vi.mocked(useEnv).mockReturnValue({ CACHE_AUDIT_ENABLED: true });
	expect(cacheAuditEnabled()).toBe(true);

	vi.mocked(useEnv).mockReturnValue({ CACHE_AUDIT_ENABLED: false });
	expect(cacheAuditEnabled()).toBe(false);

	vi.mocked(useEnv).mockReturnValue({});
	expect(cacheAuditEnabled()).toBe(false);
});
