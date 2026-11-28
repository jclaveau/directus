import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import { describe, expect, test, vi } from 'vitest';
import { defineComponent, ref } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { i18n } from '@/lang';

vi.mock('@/composables/use-item', () => {
	return {
		useItem: () => {
			return {
				isNew: ref(false),
				edits: ref({}),
				hasEdits: ref(false),
				item: ref({
					id: 'user-1',
					first_name: 'Ada',
					status: 'active',
					role: { id: 'role-1', name: 'Editor' },
					primary_identity: {
						id: 'email-identity',
						kind: 'email',
						value: 'ada@example.com',
					},
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
						fields: ref([
							{ field: 'first_name' },
							{ field: 'identities' },
							{ field: 'last_access' },
						]),
					},
				},
				saving: ref(false),
				loading: ref(false),
				save: vi.fn(),
				remove: vi.fn(),
				deleting: ref(false),
				saveAsCopy: vi.fn(),
				archive: vi.fn(),
				archiving: ref(false),
				isArchived: ref(false),
				validationErrors: ref([]),
				refresh: vi.fn(),
			};
		},
	};
});

vi.mock('@/composables/use-edits-guard', () => {
	return {
		useEditsGuard: () => {
			return { confirmLeave: ref(false), leaveTo: ref(null) };
		},
	};
});

vi.mock('@/composables/use-shortcut', () => ({ useShortcut: vi.fn() }));

vi.mock('@directus/composables', async (importOriginal) => {
	return {
		...(await importOriginal<object>()),
		useCollection: () => ({ info: ref({ meta: null }) }),
	};
});

import UserIdentities from '../components/user-identities.vue';
import UserItem from './item.vue';

const FormStub = defineComponent({
	name: 'VForm',
	props: {
		fields: { type: Array, default: () => [] },
		initialValues: { type: Object, default: () => ({}) },
	},
	template: '<div class="form-stub" />',
});

function mountUserItem(currentUserId: string) {
	return mount(UserItem, {
		props: { primaryKey: 'user-1' },
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
						userStore: { currentUser: { id: currentUserId } },
					},
				}),
			],
			components: {
				PrivateView: { template: '<div><slot /></div>' },
				VForm: FormStub,
			},
			directives: { tooltip: {} },
			stubs: {
				UserIdentities: true,
				UsersNavigation: true,
				UserInfoSidebarDetail: true,
				CommentsSidebarDetail: true,
				RevisionsDrawerDetail: true,
				SaveOptions: true,
			},
		},
	});
}

describe('the user item page', () => {
	test(
		'lists the own identities above a form without the identities field',
		() => {
			const wrapper = mountUserItem('user-1');

			expect(wrapper.find('.email').text()).toBe('ada@example.com');
			expect(wrapper.findComponent(UserIdentities).exists()).toBe(true);

			expect(wrapper.findComponent(FormStub).props('fields'))
				.toStrictEqual([{ field: 'first_name' }]);

			expect(wrapper.findComponent(FormStub).props('initialValues'))
				.toStrictEqual({
					id: 'user-1',
					first_name: 'Ada',
					status: 'active',
					role: 'role-1',
					primary_identity: 'email-identity',
				});
		},
	);

	test('keeps the identities field on the page of another user', () => {
		const wrapper = mountUserItem('user-2');

		expect(wrapper.findComponent(UserIdentities).exists()).toBe(false);

		expect(wrapper.findComponent(FormStub).props('fields')).toStrictEqual([
			{ field: 'first_name' },
			{ field: 'identities' },
		]);
	});
});
