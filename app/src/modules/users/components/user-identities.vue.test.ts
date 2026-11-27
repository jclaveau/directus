import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '@/lang';

vi.mock('@/api', () => {
	return {
		default: { get: vi.fn(), delete: vi.fn() },
	};
});

vi.mock('@/utils/unexpected-error', () => {
	return { unexpectedError: vi.fn() };
});

import api from '@/api';
import VButton from '@/components/v-button.vue';
import VChip from '@/components/v-chip.vue';
import VIcon from '@/components/v-icon/v-icon.vue';
import { unexpectedError } from '@/utils/unexpected-error';
import UserIdentities from './user-identities.vue';

function mountIdentities(providers: Record<string, unknown>[]) {
	return mount(UserIdentities, {
		global: {
			plugins: [
				i18n,
				createRouter({
					history: createMemoryHistory(),
					routes: [{ path: '/', component: { template: '<div />' } }],
				}),
				createTestingPinia({
					createSpy: vi.fn,
					initialState: {
						serverStore: {
							auth: { providers, disableDefault: false },
						},
					},
				}),
			],
			directives: {
				tooltip: {
					mounted: (el: any, binding: any) => {
						return el.setAttribute('title', binding.value);
					},
				},
			},
			components: { VButton, VChip, VIcon },
		},
	});
}

beforeEach(() => {
	vi.mocked(api.get).mockReset();
	vi.mocked(api.delete).mockReset();
	vi.mocked(unexpectedError).mockReset();
	window.history.replaceState({}, '', '/admin/users/me');

	vi.mocked(api.get).mockResolvedValue({
		data: {
			data: {
				primary_identity: 'email-identity',
				identities: [
					{
						id: 'email-identity',
						kind: 'email',
						value: 'ada@example.com',
						verified: true,
					},
					{
						id: 'github-identity',
						kind: 'github',
						value: null,
						verified: false,
					},
				],
			},
		},
	});
});

describe('the identity list', () => {
	test('reads the identities of the current user', async () => {
		mountIdentities([]);
		await flushPromises();

		expect(api.get).toHaveBeenCalledWith('/users/me', {
			params: {
				fields: [
					'primary_identity',
					'identities.id',
					'identities.kind',
					'identities.value',
					'identities.verified',
				],
			},
		});
	});

	test('shows an email value and hides an SSO value', async () => {
		const wrapper = mountIdentities([]);
		await flushPromises();

		const emailRow = wrapper.find('[data-identity="email-identity"]');
		const githubRow = wrapper.find('[data-identity="github-identity"]');

		expect(emailRow.find('.kind').text()).toBe('Email');
		expect(emailRow.find('.value').text()).toBe('ada@example.com');
		expect(emailRow.find('.primary').exists()).toBe(true);
		expect(emailRow.find('.verified').exists()).toBe(true);
		expect(githubRow.find('.kind').text()).toBe('Github');
		expect(githubRow.find('.value.hidden').text()).toBe('Hidden');
		expect(githubRow.find('.primary').exists()).toBe(false);
		expect(githubRow.find('.verified').exists()).toBe(false);
	});

	test('a failed read shows the error', async () => {
		const readError = new Error('Network Error');
		vi.mocked(api.get).mockReset();
		vi.mocked(api.get).mockRejectedValue(readError);

		mountIdentities([]);
		await flushPromises();

		expect(unexpectedError).toHaveBeenCalledWith(readError);
	});
});

describe('removing an identity', () => {
	test('deletes it and reads the list again', async () => {
		vi.mocked(api.delete).mockResolvedValue({});
		const wrapper = mountIdentities([]);
		await flushPromises();

		await wrapper.find('[data-identity="github-identity"] .remove button')
			.trigger('click');

		await flushPromises();

		expect(api.delete)
			.toHaveBeenCalledWith('/users/me/identities/github-identity');

		expect(api.get).toHaveBeenCalledTimes(2);
		expect(unexpectedError).not.toHaveBeenCalled();
	});

	test('a refused removal shows the api error', async () => {
		const lastIdentityError = new Error(
			'Invalid payload. The identity "email-identity" is the account\'s'
			+ ' last identity.',
		);

		vi.mocked(api.delete).mockRejectedValue(lastIdentityError);
		const wrapper = mountIdentities([]);
		await flushPromises();

		await wrapper.find('[data-identity="email-identity"] .remove button')
			.trigger('click');

		await flushPromises();

		expect(unexpectedError).toHaveBeenCalledWith(lastIdentityError);
		expect(api.get).toHaveBeenCalledTimes(1);
	});
});

describe('linking a provider', () => {
	test('links each oauth2 and openid provider, never a saml one', async () => {
		const wrapper = mountIdentities([
			{ name: 'github', driver: 'oauth2', label: 'GitHub', icon: 'github' },
			{ name: 'keycloak', driver: 'openid' },
			{ name: 'okta', driver: 'saml' },
			{ name: 'ldap', driver: 'ldap' },
		]);

		await flushPromises();

		const linkButtons = wrapper.findAll('.link-provider');

		expect(linkButtons.length).toBe(2);

		expect(linkButtons[0]!.find('a').attributes('href')).toBe(
			'http://localhost:3000/auth/login/github?link=true'
			+ '&redirect=http%3A%2F%2Flocalhost%3A3000%2Fadmin%2Fusers%2Fme',
		);

		expect(linkButtons[0]!.find('.content').text()).toContain('Link GitHub');

		expect(linkButtons[1]!.find('a').attributes('href')).toBe(
			'http://localhost:3000/auth/login/keycloak?link=true'
			+ '&redirect=http%3A%2F%2Flocalhost%3A3000%2Fadmin%2Fusers%2Fme',
		);

		expect(linkButtons[1]!.find('.content').text()).toContain('Link Keycloak');
	});

	test('shows no link button without a linking provider', async () => {
		const wrapper = mountIdentities([{ name: 'okta', driver: 'saml' }]);
		await flushPromises();

		expect(wrapper.find('.linking-providers').exists()).toBe(false);
	});
});
