import { cryptoStub } from '@/__utils__/crypto';
import type { GlobalMountOptions } from '@/__utils__/types';
import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import { useFieldDetailStore } from '../store';
import FieldDetailAdvancedSchema from './field-detail-advanced-schema.vue';

vi.stubGlobal('crypto', cryptoStub);

vi.mock('@/api', () => {
	return {
		default: {
			get: (path: string) => {
				throw new Error(`api.get ${JSON.stringify(path)} is not mocked`);
			},
		},
	};
});

vi.mock('@/utils/translate-object-values', () => {
	return {
		translate: (value: unknown) => value,
	};
});

const i18n = createI18n({
	legacy: false,
	locale: 'en',
	missingWarn: false,
	fallbackWarn: false,
	messages: {
		en: {
			do_nothing: 'Do Nothing',
			save_current_user_roles: 'Save Current User Roles',
		},
	},
});

const VSelectStub = {
	props: ['items', 'modelValue'],
	emits: ['update:modelValue'],
	template: '<div class="v-select-stub" />',
};

const stubs: GlobalMountOptions['stubs'] = {
	'v-select': VSelectStub,
	'v-input': true,
	'v-icon': true,
	'v-checkbox': true,
	'v-textarea': true,
	'interface-input-code': true,
};

test('a json field offers the current user roles on create and update', () => {
	const wrapper = mount(FieldDetailAdvancedSchema, {
		global: {
			stubs,
			plugins: [
				i18n,
				createTestingPinia({
					createSpy: vi.fn,
					initialState: {
						fieldDetailStore: {
							editing: '+',
							localType: 'standard',
							field: {
								field: 'owner_roles',
								type: 'json',
								schema: { is_primary_key: false },
								meta: { special: ['cast-json', 'roles-created'] },
							},
						},
					},
				}),
			],
		},
	});

	const selectStubs = wrapper.findAllComponents(VSelectStub);

	expect(selectStubs).toHaveLength(3);

	expect(selectStubs[1]!.props('items')).toEqual([
		{ text: 'Do Nothing', value: null },
		{ text: 'Save Current User Roles', value: 'roles-created' },
	]);

	expect(selectStubs[1]!.props('modelValue')).toBe('roles-created');

	expect(selectStubs[2]!.props('items')).toEqual([
		{ text: 'Do Nothing', value: null },
		{ text: 'Save Current User Roles', value: 'roles-updated' },
	]);

	expect(selectStubs[2]!.props('modelValue')).toBe(null);
});

test('picking roles-updated keeps the other specials', () => {
	const testingPinia = createTestingPinia({
		createSpy: vi.fn,
		stubActions: false,
		initialState: {
			fieldDetailStore: {
				editing: '+',
				localType: 'standard',
				field: {
					field: 'owner_roles',
					type: 'json',
					schema: { is_primary_key: false },
					meta: { special: ['cast-json', 'roles-created'] },
				},
			},
		},
	});

	const wrapper = mount(FieldDetailAdvancedSchema, {
		global: { stubs, plugins: [i18n, testingPinia] },
	});

	wrapper.findAllComponents(VSelectStub)[2]!.vm
		.$emit('update:modelValue', 'roles-updated');

	expect(useFieldDetailStore(testingPinia).field.meta!.special).toEqual([
		'cast-json',
		'roles-created',
		'roles-updated',
	]);
});

test('picking do nothing on create drops roles-created only', () => {
	const testingPinia = createTestingPinia({
		createSpy: vi.fn,
		stubActions: false,
		initialState: {
			fieldDetailStore: {
				editing: '+',
				localType: 'standard',
				field: {
					field: 'owner_roles',
					type: 'json',
					schema: { is_primary_key: false },
					meta: { special: ['cast-json', 'roles-created'] },
				},
			},
		},
	});

	const wrapper = mount(FieldDetailAdvancedSchema, {
		global: { stubs, plugins: [i18n, testingPinia] },
	});

	wrapper.findAllComponents(VSelectStub)[1]!.vm
		.$emit('update:modelValue', null);

	expect(useFieldDetailStore(testingPinia).field.meta!.special)
		.toEqual(['cast-json']);
});

test('a json file field has no create or update trigger', () => {
	const wrapper = mount(FieldDetailAdvancedSchema, {
		global: {
			stubs,
			plugins: [
				i18n,
				createTestingPinia({
					createSpy: vi.fn,
					initialState: {
						fieldDetailStore: {
							editing: '+',
							localType: 'file',
							field: {
								field: 'owner_roles',
								type: 'json',
								schema: { is_primary_key: false },
								meta: { special: null },
							},
						},
					},
				}),
			],
		},
	});

	expect(wrapper.findAllComponents(VSelectStub)).toHaveLength(1);
});

test('a uuid relation to directus_roles offers no stamp of a user', () => {
	const wrapper = mount(FieldDetailAdvancedSchema, {
		global: {
			stubs,
			plugins: [
				i18n,
				createTestingPinia({
					createSpy: vi.fn,
					initialState: {
						fieldDetailStore: {
							editing: '+',
							localType: 'm2o',
							relations: {
								m2o: { related_collection: 'directus_roles' },
							},
							field: {
								field: 'owner_role',
								type: 'uuid',
								schema: { is_primary_key: false },
								meta: { special: null },
							},
						},
					},
				}),
			],
		},
	});

	const selectStubs = wrapper.findAllComponents(VSelectStub);

	expect(selectStubs[1]!.props('items')).toEqual([
		{ text: 'Do Nothing', value: null },
	]);

	expect(selectStubs[2]!.props('items')).toEqual([
		{ text: 'Do Nothing', value: null },
	]);
});
