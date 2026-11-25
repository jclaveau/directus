import api from '@/api';
import type { GlobalMountOptions } from '@/__utils__/types';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import UsersInvite from './users-invite.vue';

vi.mock('@/api', () => {
	return {
		default: {
			get: (path: string) => {
				throw new Error(`api.get ${JSON.stringify(path)} is not spied`);
			},
			post: (path: string) => {
				throw new Error(`api.post ${JSON.stringify(path)} is not spied`);
			},
		},
	};
});

vi.mock('@/utils/unexpected-error', () => {
	return {
		unexpectedError: (error: unknown) => {
			throw error;
		},
	};
});

const i18n = createI18n({
	legacy: false,
	locale: 'en',
	missingWarn: false,
	fallbackWarn: false,
});

const VSelectStub = {
	props: { items: null, modelValue: null, multiple: Boolean },
	emits: ['update:modelValue'],
	template: '<div class="v-select-stub" />',
};

const VTextareaStub = {
	props: ['modelValue'],
	emits: ['update:modelValue'],
	template: '<div class="v-textarea-stub" />',
};

const slotStub = { template: '<div><slot /></div>' };

const global: GlobalMountOptions = {
	stubs: {
		'v-dialog': slotStub,
		'v-card': slotStub,
		'v-card-title': slotStub,
		'v-card-text': slotStub,
		'v-card-actions': slotStub,
		'v-notice': slotStub,
		'v-select': VSelectStub,
		'v-textarea': VTextareaStub,
		'v-button': {
			emits: ['click'],
			template: '<button @click="$emit(\'click\')"><slot /></button>',
		},
	},
	plugins: [i18n],
};

afterEach(() => {
	vi.restoreAllMocks();
});

test('without a role, the first role is preselected and invited', async () => {
	const apiGetSpy = vi.spyOn(api, 'get').mockResolvedValueOnce({
		data: {
			data: [
				{ id: 'role-editor', name: 'Editor' },
				{ id: 'role-staff', name: 'Staff' },
			],
		},
	});

	const apiPostSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({});

	const wrapper = mount(UsersInvite, {
		props: { modelValue: false },
		global,
	});

	await wrapper.setProps({ modelValue: true });
	await flushPromises();

	expect(apiGetSpy).toHaveBeenCalledExactlyOnceWith('/roles', {
		params: {
			sort: 'name',
			fields: ['id', 'name'],
		},
	});

	const roleSelect = wrapper.findComponent(VSelectStub);

	expect(roleSelect.props('items')).toEqual([
		{ text: 'Editor', value: 'role-editor' },
		{ text: 'Staff', value: 'role-staff' },
	]);

	expect(roleSelect.props('modelValue')).toEqual(['role-editor']);
	expect(roleSelect.props('multiple')).toBe(true);

	wrapper.findComponent(VTextareaStub).vm
		.$emit('update:modelValue', 'a@example.com, b@example.com');

	await flushPromises();
	await wrapper.findAll('button')[1]!.trigger('click');
	await flushPromises();

	expect(apiPostSpy).toHaveBeenCalledExactlyOnceWith('/users/invite', {
		email: ['a@example.com', 'b@example.com'],
		roles: ['role-editor'],
	});

	expect(wrapper.emitted('update:modelValue')).toEqual([[false]]);
});

test('roles picked in the select are all invited', async () => {
	vi.spyOn(api, 'get').mockResolvedValueOnce({
		data: {
			data: [
				{ id: 'role-editor', name: 'Editor' },
				{ id: 'role-staff', name: 'Staff' },
			],
		},
	});

	const apiPostSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({});

	const wrapper = mount(UsersInvite, {
		props: { modelValue: false },
		global,
	});

	await wrapper.setProps({ modelValue: true });
	await flushPromises();

	wrapper.findComponent(VSelectStub).vm
		.$emit('update:modelValue', ['role-editor', 'role-staff']);

	wrapper.findComponent(VTextareaStub).vm
		.$emit('update:modelValue', 'a@example.com');

	await flushPromises();
	await wrapper.findAll('button')[1]!.trigger('click');
	await flushPromises();

	expect(apiPostSpy).toHaveBeenCalledExactlyOnceWith('/users/invite', {
		email: ['a@example.com'],
		roles: ['role-editor', 'role-staff'],
	});
});

test('a role prop hides the select and is the invited role', async () => {
	vi.spyOn(api, 'get').mockResolvedValueOnce({
		data: {
			data: [
				{ id: 'role-editor', name: 'Editor' },
				{ id: 'role-staff', name: 'Staff' },
			],
		},
	});

	const apiPostSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({});

	const wrapper = mount(UsersInvite, {
		props: { modelValue: false, role: 'role-staff' },
		global,
	});

	await wrapper.setProps({ modelValue: true });
	await flushPromises();

	expect(wrapper.findComponent(VSelectStub).exists()).toBe(false);

	wrapper.findComponent(VTextareaStub).vm
		.$emit('update:modelValue', 'a@example.com');

	await flushPromises();
	await wrapper.findAll('button')[1]!.trigger('click');
	await flushPromises();

	expect(apiPostSpy).toHaveBeenCalledExactlyOnceWith('/users/invite', {
		email: ['a@example.com'],
		roles: ['role-staff'],
	});
});

test('emptying the roles select blocks the invite', async () => {
	vi.spyOn(api, 'get').mockResolvedValueOnce({
		data: { data: [{ id: 'role-editor', name: 'Editor' }] },
	});

	const apiPostSpy = vi.spyOn(api, 'post').mockResolvedValueOnce({});

	const wrapper = mount(UsersInvite, {
		props: { modelValue: false },
		global,
	});

	await wrapper.setProps({ modelValue: true });
	await flushPromises();

	wrapper.findComponent(VSelectStub).vm.$emit('update:modelValue', []);

	wrapper.findComponent(VTextareaStub).vm
		.$emit('update:modelValue', 'a@example.com');

	await flushPromises();
	await wrapper.findAll('button')[1]!.trigger('click');
	await flushPromises();

	expect(apiPostSpy).not.toHaveBeenCalled();
});
