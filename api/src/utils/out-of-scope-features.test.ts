import { useEnv } from '@directus/env';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import {
	allowedOutOfScopeFeatures,
	refuseOutOfScopeFeature,
} from './out-of-scope-features.js';

vi.mock('@directus/env');

beforeEach(() => {
	vi.mocked(useEnv, { partial: true }).mockReturnValue({});
});

describe('allowedOutOfScopeFeatures', () => {
	test('reads a list, trimming each name and dropping the empty ones', () => {
		vi.mocked(useEnv, { partial: true }).mockReturnValue({
			OUT_OF_SCOPE_FEATURES_ALLOWED: [' shares', '', 'comments '],
		});

		expect(allowedOutOfScopeFeatures()).toEqual(['shares', 'comments']);
	});

	test('reads an unset variable as no feature', () => {
		expect(allowedOutOfScopeFeatures()).toEqual([]);
	});
});

describe('refuseOutOfScopeFeature', () => {
	test('lets an allowed feature through', () => {
		vi.mocked(useEnv, { partial: true }).mockReturnValue({
			OUT_OF_SCOPE_FEATURES_ALLOWED: ['shares'],
		});

		expect(refuseOutOfScopeFeature('shares')).toBeUndefined();
	});

	test('refuses a feature the list leaves out, naming its issue', () => {
		vi.mocked(useEnv, { partial: true }).mockReturnValue({
			OUT_OF_SCOPE_FEATURES_ALLOWED: ['shares'],
		});

		expect(() => refuseOutOfScopeFeature('comments')).toThrow(
			expect.objectContaining({
				status: 503,
				code: 'SERVICE_UNAVAILABLE',
				message: 'Service "comments" is unavailable. It is out of the tested'
					+ ' scope (#647): add "comments" to OUT_OF_SCOPE_FEATURES_ALLOWED'
					+ ' to run it untested.',
			}),
		);
	});
});
