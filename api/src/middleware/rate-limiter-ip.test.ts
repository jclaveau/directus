import { beforeEach, describe, expect, it, vi } from 'vitest';
import { resolvedRateLimiterCharge } from './rate-limiter-ip.js';

// `rate-limiter-ip.ts` calls `useEnv()` at module scope, which runs while the mock
// factory is still hoisted above a plain `const` — hence `vi.hoisted`, so the object
// exists before the import and stays the same reference the module captured.
const env = vi.hoisted(() => ({}) as Record<string, any>);

vi.mock('@directus/env', () => ({ useEnv: () => env }));

beforeEach(() => {
	env['RATE_LIMITER_ENABLED'] = false;
	env['RATE_LIMITER_CHARGE'] = 'cache-misses';
});

describe('resolvedRateLimiterCharge', () => {
	it('keeps the charge on misses by default, so a cache hit costs nothing', () => {
		expect(resolvedRateLimiterCharge()).toBe('cache-misses');
	});

	it('charges every request when asked for upstream\'s position', () => {
		env['RATE_LIMITER_CHARGE'] = 'every-request';

		expect(resolvedRateLimiterCharge()).toBe('every-request');
	});

	// A typo must not read as the default: silently charging misses when the operator
	// asked for something else is the failure this whole issue is about, inverted.
	it.each(['', 'every_request', 'cache-miss', 'true', 'misses'])(
		'refuses an unknown charge (%s) rather than guessing',
		(unknown) => {
			env['RATE_LIMITER_CHARGE'] = unknown;

			expect(() => resolvedRateLimiterCharge())
				.toThrow(/Invalid RATE_LIMITER_CHARGE/);
		},
	);

	it('names the offending value and both accepted ones', () => {
		env['RATE_LIMITER_CHARGE'] = 'nonsense';

		expect(() => resolvedRateLimiterCharge())
			.toThrow('Invalid RATE_LIMITER_CHARGE "nonsense" — expected '
				+ '"cache-misses" or "every-request"');
	});
});
