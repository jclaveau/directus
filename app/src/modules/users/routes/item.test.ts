import { generateRouter } from '@/__utils__/router';
import type { GlobalMountOptions } from '@/__utils__/types';
import * as useItemModule from '@/composables/use-item';
import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';
import { ref } from 'vue';
import { createI18n } from 'vue-i18n';
import UsersItem from './item.vue';

vi.mock('@/api', () => {
	return {
		default: {
			get: (path: string) => {
				throw new Error(`api.get ${JSON.stringify(path)} is not mocked`);
			},
		},
	};
});

vi.mock('@/auth', () => {
	return {
		logout: () => {
			throw new Error('logout is not mocked');
		},
	};
});

vi.mock('@/composables/use-item', () => {
	return {
		useItem: () => {
			throw new Error('useItem is not spied');
		},
	};
});

vi.mock('@/composables/use-shortcut', () => {
	return {
		useShortcut: () => {},
	};
});

vi.mock('@/composables/use-edits-guard', async () => {
	const { ref: vueRef } = await import('vue');

	return {
		useEditsGuard: () => {
			return {
				confirmLeave: vueRef(false),
				leaveTo: vueRef(null),
			};
		},
	};
});

vi.mock('@directus/composables', async () => {
	const { ref: vueRef } = await import('vue');

	return {
		useCollection: () => ({ info: vueRef({ meta: null }) }),
	};
});

vi.mock('../components/navigation.vue', () => {
	return {
		default: {
			name: 'UsersNavigation',
			props: ['currentRole'],
			template: '<div />',
		},
	};
});

vi.mock('../components/user-info-sidebar-detail.vue', () => {
	return {
		default: { props: ['isNew', 'user'], template: '<div />' },
	};
});

vi.mock('../components/user-policies-sidebar-detail.vue', () => {
	return {
		default: {
			name: 'UserPoliciesSidebarDetail',
			props: ['userId', 'memberRoleIds'],
			template: '<div />',
		},
	};
});

vi.mock('@/views/private/components/revisions-drawer-detail.vue', () => {
	return { default: { template: '<div />' } };
});

vi.mock('@/views/private/components/comments-sidebar-detail.vue', () => {
	return { default: { template: '<div />' } };
});

vi.mock('@/views/private/components/save-options.vue', () => {
	return { default: { template: '<div />' } };
});

const i18n = createI18n({
	legacy: false,
	locale: 'en',
	missingWarn: false,
	fallbackWarn: false,
});

const slotStub = { template: '<div><slot /></div>' };

const VFormStub = {
	name: 'VForm',
	props: ['initialValues'],
	template: '<div />',
};

const global: GlobalMountOptions = {
	stubs: {
		'private-view': {
			template: '<div><slot name="navigation" /><slot />'
				+ '<slot name="sidebar" /></div>',
		},
		'v-button': slotStub,
		'v-icon': true,
		'v-breadcrumb': true,
		'v-dialog': slotStub,
		'v-card': slotStub,
		'v-card-title': slotStub,
		'v-card-text': slotStub,
		'v-card-actions': slotStub,
		'v-skeleton-loader': true,
		'v-image': true,
		'v-chip': { template: '<span class="v-chip-stub"><slot /></span>' },
		'v-form': VFormStub,
	},
	directives: { tooltip: {} },
	plugins: [
		i18n,
		generateRouter(),
		createTestingPinia({ createSpy: vi.fn }),
	],
};

afterEach(() => {
	vi.restoreAllMocks();
});

test('an existing user shows a chip and a policy source per member role', () => {
	vi.spyOn(useItemModule, 'useItem').mockReturnValue({
		isNew: ref(false),
		edits: ref({}),
		hasEdits: ref(false),
		item: ref({
			id: 'user-1',
			first_name: 'Ada',
			status: 'active',
			roles: [
				{
					id: 'membership-1',
					role: { id: 'role-editor', name: 'Editor' },
				},
				{
					id: 'membership-2',
					role: { id: 'role-staff', name: 'Staff' },
				},
			],
		}),
		permissions: {
			collectionPermissions: {
				createAllowed: ref(true),
				revisionsAllowed: ref(false),
			},
			itemPermissions: {
				updateAllowed: ref(true),
				deleteAllowed: ref(true),
				saveAllowed: ref(true),
				archiveAllowed: ref(true),
				fields: ref([]),
			},
		},
		saving: ref(false),
		loading: ref(false),
		deleting: ref(false),
		archiving: ref(false),
		isArchived: ref(false),
		validationErrors: ref([]),
	} as any);

	const wrapper = mount(UsersItem, {
		props: { primaryKey: 'user-1' },
		global,
	});

	const roleChips = wrapper.findAll('.v-chip-stub');

	expect(roleChips).toHaveLength(2);
	expect(roleChips[0]!.text()).toBe('Editor');
	expect(roleChips[1]!.text()).toBe('Staff');

	const policiesDetail = wrapper
		.findComponent({ name: 'UserPoliciesSidebarDetail' });

	expect(policiesDetail.props('userId')).toBe('user-1');

	expect(policiesDetail.props('memberRoleIds'))
		.toEqual(['role-editor', 'role-staff']);

	expect(wrapper.findComponent({ name: 'UsersNavigation' })
		.props('currentRole')).toBe('role-editor');

	expect(wrapper.findComponent(VFormStub).props('initialValues')).toEqual({
		id: 'user-1',
		first_name: 'Ada',
		status: 'active',
		roles: ['membership-1', 'membership-2'],
	});
});

test('a new user under a role starts with a membership of that role', () => {
	const itemEdits = ref({});

	vi.spyOn(useItemModule, 'useItem').mockReturnValue({
		isNew: ref(true),
		edits: itemEdits,
		hasEdits: ref(false),
		item: ref(null),
		permissions: {
			collectionPermissions: {
				createAllowed: ref(true),
				revisionsAllowed: ref(false),
			},
			itemPermissions: {
				updateAllowed: ref(true),
				deleteAllowed: ref(true),
				saveAllowed: ref(true),
				archiveAllowed: ref(true),
				fields: ref([]),
			},
		},
		saving: ref(false),
		loading: ref(false),
		deleting: ref(false),
		archiving: ref(false),
		isArchived: ref(false),
		validationErrors: ref([]),
	} as any);

	const wrapper = mount(UsersItem, {
		props: { primaryKey: '+', role: 'role-editor' },
		global,
	});

	expect(itemEdits.value).toEqual({
		roles: {
			create: [{ role: 'role-editor' }],
			update: [],
			delete: [],
		},
	});

	expect(wrapper.findComponent({ name: 'UserPoliciesSidebarDetail' })
		.exists()).toBe(false);

	expect(wrapper.findComponent({ name: 'UsersNavigation' })
		.props('currentRole')).toBe('role-editor');

	expect(wrapper.findAll('.v-chip-stub')).toHaveLength(0);
});
