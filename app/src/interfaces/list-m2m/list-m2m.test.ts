import { useRelationM2M } from '@/composables/use-relation-m2m';
import { useRelationMultiple } from '@/composables/use-relation-multiple';
import { useRelationPermissionsM2M } from '@/composables/use-relation-permissions';
import { i18n } from '@/lang';
import { useFieldsStore } from '@/stores/fields';
import { LAYOUTS } from '@/types/interfaces';
import type { Field } from '@directus/types';
import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';
import { h, ref } from 'vue';
import ListM2M from './list-m2m.vue';

vi.mock('@/composables/use-relation-m2m', () => ({ useRelationM2M: vi.fn() }));

vi.mock('@/composables/use-relation-multiple', () => {
	return { useRelationMultiple: vi.fn() };
});

vi.mock('@/composables/use-relation-permissions', () => {
	return { useRelationPermissionsM2M: vi.fn() };
});

afterEach(() => {
	vi.restoreAllMocks();
});

test('shows "Managed by" in place of the remove button in a list', () => {
	const pinia = createTestingPinia({ createSpy: vi.fn });

	vi.mocked(useFieldsStore(pinia).getField).mockReturnValue({
		collection: 'directus_access',
		field: 'managed_by',
		name: 'Managed By',
		type: 'string',
		schema: null,
		meta: { display: null },
	} as Field);

	vi.mocked(useRelationM2M).mockReturnValue({
		relationInfo: ref({
			junctionCollection: { collection: 'directus_access', meta: null },
			relatedCollection: { collection: 'directus_policies', meta: null },
			relation: { field: 'policy' },
			junctionPrimaryKeyField: { field: 'id' },
			relatedPrimaryKeyField: { field: 'id' },
			junctionField: { field: 'policy' },
			reverseJunctionField: { field: 'user' },
		}),
	} as any);

	vi.mocked(useRelationMultiple).mockReturnValue({
		displayItems: ref([
			{ id: 1, policy: { id: 'p1', name: 'Billing' }, managed_by: 'stripe-sync' },
			{ id: 2, policy: { id: 'p2', name: 'Editors' }, managed_by: null },
		]),
		totalItemCount: ref(2),
		loading: ref(false),
		selected: ref([]),
		isLocalItem: vi.fn(),
		getItemEdits: vi.fn(),
	} as any);

	vi.mocked(useRelationPermissionsM2M).mockReturnValue({
		createAllowed: ref(false),
		updateAllowed: ref(false),
		deleteAllowed: ref(true),
		selectAllowed: ref(false),
	} as any);

	const wrapper = mount(ListM2M, {
		props: {
			primaryKey: 'user-id',
			collection: 'directus_users',
			field: 'policies',
			width: 'full',
			version: null,
			layout: LAYOUTS.LIST,
			template: '{{policy.name}}',
			managedByField: 'managed_by',
		},
		global: {
			plugins: [i18n, pinia],
			directives: { tooltip: { mounted: () => undefined } },
			stubs: {
				Draggable: {
					props: ['modelValue'],
					setup: (props: any, { slots }: any) => {
						return () => {
							return h('div', props.modelValue.map((element: any) => {
								return slots.item({ element });
							}));
						};
					},
				},
				DrawerItem: true,
				DrawerCollection: true,
				DrawerBatch: true,
				SearchInput: true,
			},
			config: {
				compilerOptions: {
					isCustomElement: (tag: string) => tag.includes('-'),
				},
			},
		},
	});

	expect(vi.mocked(useRelationMultiple).mock.lastCall![1].value.fields)
		.toEqual(['policy.name', 'managed_by']);

	expect(wrapper.findAll('.item-actions')[0]!.text())
		.toBe('Managed by stripe-sync');

	expect(wrapper.findAll('.item-actions')[0]!.find('v-remove').exists())
		.toBe(false);

	expect(wrapper.findAll('.item-actions')[1]!.text()).toBe('');

	expect(wrapper.findAll('.item-actions')[1]!.find('v-remove').exists())
		.toBe(true);
});

test('shows "Managed by" in place of the remove button in a table', () => {
	const pinia = createTestingPinia({ createSpy: vi.fn });

	vi.mocked(useFieldsStore(pinia).getField).mockReturnValue({
		collection: 'directus_access',
		field: 'managed_by',
		name: 'Managed By',
		type: 'string',
		schema: null,
		meta: { display: null },
	} as Field);

	vi.mocked(useRelationM2M).mockReturnValue({
		relationInfo: ref({
			junctionCollection: { collection: 'directus_access', meta: null },
			relatedCollection: { collection: 'directus_policies', meta: null },
			relation: { field: 'policy' },
			junctionPrimaryKeyField: { field: 'id' },
			relatedPrimaryKeyField: { field: 'id' },
			junctionField: { field: 'policy' },
			reverseJunctionField: { field: 'user' },
		}),
	} as any);

	vi.mocked(useRelationMultiple).mockReturnValue({
		displayItems: ref([
			{ id: 1, policy: { id: 'p1', name: 'Billing' }, managed_by: 'stripe-sync' },
			{ id: 2, policy: { id: 'p2', name: 'Editors' }, managed_by: null },
		]),
		totalItemCount: ref(2),
		loading: ref(false),
		selected: ref([]),
		isLocalItem: vi.fn(),
		getItemEdits: vi.fn(),
	} as any);

	vi.mocked(useRelationPermissionsM2M).mockReturnValue({
		createAllowed: ref(false),
		updateAllowed: ref(false),
		deleteAllowed: ref(true),
		selectAllowed: ref(false),
	} as any);

	const wrapper = mount(ListM2M, {
		props: {
			primaryKey: 'user-id',
			collection: 'directus_users',
			field: 'policies',
			width: 'full',
			version: null,
			layout: LAYOUTS.TABLE,
			fields: ['policy.name'],
			managedByField: 'managed_by',
		},
		global: {
			plugins: [i18n, pinia],
			directives: { tooltip: { mounted: () => undefined } },
			components: {
				VTable: {
					props: ['items'],
					setup: (props: any, { slots }: any) => {
						return () => {
							return h('div', props.items.map((item: any) => {
								return slots['item-append']({ item });
							}));
						};
					},
				},
			},
			stubs: {
				DrawerItem: true,
				DrawerCollection: true,
				DrawerBatch: true,
				SearchInput: true,
			},
			config: {
				compilerOptions: {
					isCustomElement: (tag: string) => tag.includes('-'),
				},
			},
		},
	});

	expect(vi.mocked(useRelationMultiple).mock.lastCall![1].value.fields)
		.toEqual(['policy.name', 'managed_by']);

	expect(wrapper.findAll('.item-actions')[0]!.text())
		.toBe('Managed by stripe-sync');

	expect(wrapper.findAll('.item-actions')[0]!.find('v-remove').exists())
		.toBe(false);

	expect(wrapper.findAll('.item-actions')[1]!.text()).toBe('');

	expect(wrapper.findAll('.item-actions')[1]!.find('v-remove').exists())
		.toBe(true);
});

test('keeps the undo button of a row staged for deletion in a list', () => {
	const pinia = createTestingPinia({ createSpy: vi.fn });

	vi.mocked(useFieldsStore(pinia).getField).mockReturnValue({
		collection: 'directus_access',
		field: 'managed_by',
		name: 'Managed By',
		type: 'string',
		schema: null,
		meta: { display: null },
	} as Field);

	vi.mocked(useRelationM2M).mockReturnValue({
		relationInfo: ref({
			junctionCollection: { collection: 'directus_access', meta: null },
			relatedCollection: { collection: 'directus_policies', meta: null },
			relation: { field: 'policy' },
			junctionPrimaryKeyField: { field: 'id' },
			relatedPrimaryKeyField: { field: 'id' },
			junctionField: { field: 'policy' },
			reverseJunctionField: { field: 'user' },
		}),
	} as any);

	vi.mocked(useRelationMultiple).mockReturnValue({
		displayItems: ref([{
			id: 1,
			policy: { id: 'p1', name: 'Billing' },
			managed_by: 'stripe-sync',
			$type: 'deleted',
		}]),
		totalItemCount: ref(1),
		loading: ref(false),
		selected: ref([]),
		isLocalItem: vi.fn(),
		getItemEdits: vi.fn(),
	} as any);

	vi.mocked(useRelationPermissionsM2M).mockReturnValue({
		createAllowed: ref(false),
		updateAllowed: ref(false),
		deleteAllowed: ref(true),
		selectAllowed: ref(false),
	} as any);

	const wrapper = mount(ListM2M, {
		props: {
			primaryKey: 'user-id',
			collection: 'directus_users',
			field: 'policies',
			width: 'full',
			version: null,
			layout: LAYOUTS.LIST,
			template: '{{policy.name}}',
			managedByField: 'managed_by',
		},
		global: {
			plugins: [i18n, pinia],
			directives: { tooltip: { mounted: () => undefined } },
			stubs: {
				Draggable: {
					props: ['modelValue'],
					setup: (props: any, { slots }: any) => {
						return () => {
							return h('div', props.modelValue.map((element: any) => {
								return slots.item({ element });
							}));
						};
					},
				},
				DrawerItem: true,
				DrawerCollection: true,
				DrawerBatch: true,
				SearchInput: true,
			},
			config: {
				compilerOptions: {
					isCustomElement: (tag: string) => tag.includes('-'),
				},
			},
		},
	});

	expect(wrapper.findAll('.item-actions')[0]!.text()).toBe('');

	expect(wrapper.findAll('.item-actions')[0]!.find('v-remove').exists())
		.toBe(true);
});

test('keeps the undo button of a row staged for deletion in a table', () => {
	const pinia = createTestingPinia({ createSpy: vi.fn });

	vi.mocked(useFieldsStore(pinia).getField).mockReturnValue({
		collection: 'directus_access',
		field: 'managed_by',
		name: 'Managed By',
		type: 'string',
		schema: null,
		meta: { display: null },
	} as Field);

	vi.mocked(useRelationM2M).mockReturnValue({
		relationInfo: ref({
			junctionCollection: { collection: 'directus_access', meta: null },
			relatedCollection: { collection: 'directus_policies', meta: null },
			relation: { field: 'policy' },
			junctionPrimaryKeyField: { field: 'id' },
			relatedPrimaryKeyField: { field: 'id' },
			junctionField: { field: 'policy' },
			reverseJunctionField: { field: 'user' },
		}),
	} as any);

	vi.mocked(useRelationMultiple).mockReturnValue({
		displayItems: ref([{
			id: 1,
			policy: { id: 'p1', name: 'Billing' },
			managed_by: 'stripe-sync',
			$type: 'deleted',
		}]),
		totalItemCount: ref(1),
		loading: ref(false),
		selected: ref([]),
		isLocalItem: vi.fn(),
		getItemEdits: vi.fn(),
	} as any);

	vi.mocked(useRelationPermissionsM2M).mockReturnValue({
		createAllowed: ref(false),
		updateAllowed: ref(false),
		deleteAllowed: ref(true),
		selectAllowed: ref(false),
	} as any);

	const wrapper = mount(ListM2M, {
		props: {
			primaryKey: 'user-id',
			collection: 'directus_users',
			field: 'policies',
			width: 'full',
			version: null,
			layout: LAYOUTS.TABLE,
			fields: ['policy.name'],
			managedByField: 'managed_by',
		},
		global: {
			plugins: [i18n, pinia],
			directives: { tooltip: { mounted: () => undefined } },
			components: {
				VTable: {
					props: ['items'],
					setup: (props: any, { slots }: any) => {
						return () => {
							return h('div', props.items.map((item: any) => {
								return slots['item-append']({ item });
							}));
						};
					},
				},
			},
			stubs: {
				DrawerItem: true,
				DrawerCollection: true,
				DrawerBatch: true,
				SearchInput: true,
			},
			config: {
				compilerOptions: {
					isCustomElement: (tag: string) => tag.includes('-'),
				},
			},
		},
	});

	expect(wrapper.findAll('.item-actions')[0]!.text()).toBe('');

	expect(wrapper.findAll('.item-actions')[0]!.find('v-remove').exists())
		.toBe(true);
});

test('does not fetch the managed-by field when it is not readable', () => {
	const pinia = createTestingPinia({ createSpy: vi.fn });

	vi.mocked(useFieldsStore(pinia).getField).mockReturnValue(null);

	vi.mocked(useRelationM2M).mockReturnValue({
		relationInfo: ref({
			junctionCollection: { collection: 'directus_access', meta: null },
			relatedCollection: { collection: 'directus_policies', meta: null },
			relation: { field: 'policy' },
			junctionPrimaryKeyField: { field: 'id' },
			relatedPrimaryKeyField: { field: 'id' },
			junctionField: { field: 'policy' },
			reverseJunctionField: { field: 'user' },
		}),
	} as any);

	vi.mocked(useRelationMultiple).mockReturnValue({
		displayItems: ref([]),
		totalItemCount: ref(0),
		loading: ref(false),
		selected: ref([]),
		isLocalItem: vi.fn(),
		getItemEdits: vi.fn(),
	} as any);

	vi.mocked(useRelationPermissionsM2M).mockReturnValue({
		createAllowed: ref(false),
		updateAllowed: ref(false),
		deleteAllowed: ref(true),
		selectAllowed: ref(false),
	} as any);

	mount(ListM2M, {
		props: {
			primaryKey: 'user-id',
			collection: 'directus_users',
			field: 'policies',
			width: 'full',
			version: null,
			layout: LAYOUTS.LIST,
			template: '{{policy.name}}',
			managedByField: 'managed_by',
		},
		global: {
			plugins: [i18n, pinia],
			directives: { tooltip: { mounted: () => undefined } },
			stubs: {
				Draggable: true,
				DrawerItem: true,
				DrawerCollection: true,
				DrawerBatch: true,
				SearchInput: true,
			},
			config: {
				compilerOptions: {
					isCustomElement: (tag: string) => tag.includes('-'),
				},
			},
		},
	});

	expect(vi.mocked(useRelationMultiple).mock.lastCall![1].value.fields)
		.toEqual(['policy.name']);

	expect(useFieldsStore(pinia).getField)
		.toHaveBeenCalledWith('directus_access', 'managed_by');
});
