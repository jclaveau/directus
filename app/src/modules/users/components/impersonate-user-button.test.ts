import type { GlobalMountOptions } from '@/__utils__/types';
import { useSettingsStore } from '@/stores/settings';
import { useUserStore } from '@/stores/user';
import { createTestingPinia } from '@pinia/testing';
import { flushPromises, mount } from '@vue/test-utils';
import { setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import ImpersonateUserButton from './impersonate-user-button.vue';

const impersonate = vi.hoisted(() => vi.fn());

vi.mock('@/composables/use-impersonate', async () => {
	const { ref } = await import('vue');

	return {
		useImpersonate: () => ({ impersonating: ref(false), impersonate }),
	};
});

const i18n = createI18n({
	legacy: false,
	locale: 'en',
	messages: {
		en: {
			impersonate: 'Impersonate',
			impersonate_confirm: 'Impersonate {user}?',
			impersonate_explain: 'Explain',
			impersonate_in_project_website: 'In the project website',
			impersonate_in_project_website_hint: 'Opens the website',
			impersonate_in_data_studio: 'In the Data Studio',
			impersonate_no_project_url: 'Set the Project URL',
			cancel: 'Cancel',
		},
	},
});

const VDialogStub = {
	props: ['modelValue'],
	emits: ['update:modelValue', 'esc'],
	template: `
		<div class="dialog">
			<slot name="activator" :on="() => $emit('update:modelValue', true)" />
			<div v-if="modelValue" class="card"><slot /></div>
		</div>
	`,
};

const VButtonStub = {
	props: ['disabled', 'loading'],
	emits: ['click'],
	template: `
		<button :disabled="disabled" @click="$emit('click')"><slot /></button>
	`,
};

const SlotStub = { template: '<div><slot /></div>' };

const global: GlobalMountOptions = {
	stubs: {
		'v-dialog': VDialogStub,
		'v-button': VButtonStub,
		'v-icon': true,
		'v-card': SlotStub,
		'v-card-title': { template: '<h2><slot /></h2>' },
		'v-card-text': SlotStub,
		'v-card-actions': SlotStub,
	},
	directives: { tooltip: { mounted: () => undefined } },
	plugins: [i18n],
};

beforeEach(() => {
	setActivePinia(createTestingPinia({ createSpy: vi.fn }));

	Object.assign(useUserStore(), {
		currentUser: { id: 'admin', admin_access: true },
		impersonationAvailable: true,
		impersonator: null,
	});
});

afterEach(() => {
	vi.clearAllMocks();
});

test('offers an admin to impersonate another user', () => {
	const wrapper = mount(ImpersonateUserButton, {
		props: { userId: 'jane', title: 'Jane Doe' },
		global,
	});

	expect(wrapper.find('.dialog').exists()).toBe(true);
	expect(wrapper.find('.card').exists()).toBe(false);
});

test.each([
	['impersonation is off', { impersonationAvailable: false }, 'jane'],
	['the viewer is no admin', { currentUser: { id: 'admin' } }, 'jane'],
	[
		'the viewer is impersonating already',
		{ impersonator: { first_name: 'Ad', last_name: 'Min' } },
		'jane',
	],
	[
		'the viewer is a share',
		{ currentUser: { share: 'share-1', admin_access: true } },
		'jane',
	],
	['the user is new or still loading', {}, null],
	['the user is the viewer', {}, 'admin'],
])('offers nothing when %s', (_, userState, userId) => {
	Object.assign(useUserStore(), userState);

	const wrapper = mount(ImpersonateUserButton, {
		props: { userId, title: 'Jane Doe' },
		global,
	});

	expect(wrapper.html()).toBe('<!--v-if-->');
});

test('the Data Studio button starts a session mode and closes', async () => {
	impersonate.mockResolvedValue(true);

	const wrapper = mount(ImpersonateUserButton, {
		props: { userId: 'jane', title: 'Jane Doe' },
		global,
	});

	await wrapper.find('button').trigger('click');

	expect(wrapper.find('h2').text()).toBe('Impersonate Jane Doe?');

	await wrapper.findAll('button')[3]!.trigger('click');
	await flushPromises();

	expect(impersonate).toHaveBeenCalledExactlyOnceWith('jane', 'session', null);
	expect(wrapper.find('.card').exists()).toBe(false);
});

test('the website button waits for a project URL', async () => {
	const wrapper = mount(ImpersonateUserButton, {
		props: { userId: 'jane', title: 'Jane Doe' },
		global,
	});

	await wrapper.find('button').trigger('click');

	expect(wrapper.findAll('button')[2]!.attributes('disabled')).toBe('');
});

test('the website button hands the project URL over', async () => {
	impersonate.mockResolvedValue(true);

	useSettingsStore().settings = {
		project_url: 'https://example.com',
	} as never;

	const wrapper = mount(ImpersonateUserButton, {
		props: { userId: 'jane', title: 'Jane Doe' },
		global,
	});

	await wrapper.find('button').trigger('click');
	await wrapper.findAll('button')[2]!.trigger('click');
	await flushPromises();

	expect(impersonate).toHaveBeenCalledExactlyOnceWith(
		'jane',
		'cookie',
		'https://example.com',
	);
});

test('a refused impersonation leaves the dialog open', async () => {
	impersonate.mockResolvedValue(false);

	const wrapper = mount(ImpersonateUserButton, {
		props: { userId: 'jane', title: 'Jane Doe' },
		global,
	});

	await wrapper.find('button').trigger('click');
	await wrapper.findAll('button')[3]!.trigger('click');
	await flushPromises();

	expect(wrapper.find('.card').exists()).toBe(true);
});

test('Cancel closes the dialog', async () => {
	const wrapper = mount(ImpersonateUserButton, {
		props: { userId: 'jane', title: 'Jane Doe' },
		global,
	});

	await wrapper.find('button').trigger('click');
	await wrapper.findAll('button')[1]!.trigger('click');

	expect(wrapper.find('.card').exists()).toBe(false);
});

test('Escape closes the dialog', async () => {
	const wrapper = mount(ImpersonateUserButton, {
		props: { userId: 'jane', title: 'Jane Doe' },
		global,
	});

	await wrapper.find('button').trigger('click');
	wrapper.findComponent(VDialogStub).vm.$emit('esc');
	await flushPromises();

	expect(wrapper.find('.card').exists()).toBe(false);
});
