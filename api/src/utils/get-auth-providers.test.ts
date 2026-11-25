import { useEnv } from '@directus/env';
import { describe, expect, test, vi } from 'vitest';
import { getAuthProviders } from './get-auth-providers.js';

vi.mock('@directus/env');

const scenarios = [
	{
		name: 'when no providers configured',
		input: {},
		output: [],
	},
	{
		name: 'when no driver configured',
		input: {
			AUTH_PROVIDERS: 'directus',
		},
		output: [],
	},

	{
		name: 'when single provider and driver are properly configured',
		input: {
			AUTH_PROVIDERS: 'directus',
			AUTH_DIRECTUS_DRIVER: 'openid',
			AUTH_DIRECTUS_LABEL: 'Directus',
			AUTH_DIRECTUS_ICON: 'hare',
		},
		output: [
			{
				name: 'directus',
				driver: 'openid',
				label: 'Directus',
				icon: 'hare',
			},
		],
	},

	{
		name: 'when multiple provider and driver are properly configured',
		input: {
			AUTH_PROVIDERS: 'directus,custom',
			AUTH_DIRECTUS_DRIVER: 'openid',
			AUTH_DIRECTUS_LABEL: 'Directus',
			AUTH_DIRECTUS_ICON: 'hare',
			AUTH_CUSTOM_DRIVER: 'openid',
			AUTH_CUSTOM_ICON: 'lock',
		},
		output: [
			{
				name: 'directus',
				driver: 'openid',
				label: 'Directus',
				icon: 'hare',
			},
			{
				name: 'custom',
				driver: 'openid',
				icon: 'lock',
			},
		],
	},
];

describe('get auth providers', () => {
	for (const scenario of scenarios) {
		test(scenario.name, () => {
			vi.mocked(useEnv, { partial: true }).mockReturnValue(scenario.input);

			expect(getAuthProviders()).toEqual(scenario.output);
		});
	}

	test('keeps the session providers only when asked', () => {
		vi.mocked(useEnv, { partial: true }).mockReturnValue({
			AUTH_PROVIDERS: 'google,github,okta,ldap',
			AUTH_GOOGLE_DRIVER: 'openid',
			AUTH_GOOGLE_MODE: 'json',
			AUTH_GITHUB_DRIVER: 'oauth2',
			AUTH_OKTA_DRIVER: 'saml',
			AUTH_OKTA_MODE: 'session',
			AUTH_LDAP_DRIVER: 'ldap',
		});

		expect(getAuthProviders({ sessionOnly: true })).toEqual([
			{ name: 'github', driver: 'oauth2' },
			{ name: 'okta', driver: 'saml' },
			{ name: 'ldap', driver: 'ldap' },
		]);
	});
});
