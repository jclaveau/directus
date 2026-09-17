import type { GlobalMountOptions } from '@/__utils__/types';
import { useUserStore } from '@/stores/user';
import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import ImpersonationBanner from './impersonation-banner.vue';

const api = vi.hoisted(() => ({ delete: vi.fn() }));
vi.mock('@/api', () => ({ default: api }));

const unexpectedError = vi.hoisted(() => vi.fn());
vi.mock('@/utils/unexpected-error', () => ({ unexpectedError }));

const i18n = createI18n({
	legacy: false,
	locale: 'en',
	messages: {
		en: {
			impersonation_banner: '{admin} sees this as {user}',
			stop_impersonation: 'Stop',
		},
	},
});

const VButtonStub = {
	props: ['loading'],
	emits: ['click'],
	template: '<button @click="$emit(\'click\')"><slot /></button>',
};

const global: GlobalMountOptions = {
	stubs: { 'v-icon': true, 'v-button': VButtonStub },
	plugins: [i18n],
};

const reload = vi.fn();

beforeEach(() => {
	setActivePinia(createTestingPinia({ createSpy: vi.fn }));
	vi.stubGlobal('location', { reload });
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

function mountAs(impersonator: { first_name: string; last_name: string } | null) {
	const userStore = useUserStore();
	userStore.currentUser = { first_name: 'Jane', last_name: 'Doe' } as never;
	userStore.impersonator = impersonator as never;

	return mount(ImpersonationBanner, { global });
}

test('renders nothing outside an impersonation', () => {
	const wrapper = mountAs(null);

	expect(wrapper.find('.impersonation-banner').exists()).toBe(false);
});

test('names the admin and the target', () => {
	const wrapper = mountAs({ first_name: 'Ad', last_name: 'Min' });

	expect(wrapper.find('.message').text()).toBe('Ad Min sees this as Jane Doe');
});

test('Stop ends the impersonation and reloads', async () => {
	api.delete.mockResolvedValue({});
	const wrapper = mountAs({ first_name: 'Ad', last_name: 'Min' });

	await wrapper.find('button').trigger('click');
	await flushPromises();

	expect(api.delete).toHaveBeenCalledWith('/auth/impersonate');
	expect(reload).toHaveBeenCalledTimes(1);
});

test('a refused Stop is reported and the button released', async () => {
	const error = new Error('nope');
	api.delete.mockRejectedValue(error);
	const wrapper = mountAs({ first_name: 'Ad', last_name: 'Min' });

	await wrapper.find('button').trigger('click');
	await flushPromises();

	expect(unexpectedError).toHaveBeenCalledWith(error);
	expect(reload).not.toHaveBeenCalled();
	expect(wrapper.findComponent(VButtonStub).props('loading')).toBe(false);
});
