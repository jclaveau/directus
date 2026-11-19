import api from '@/api';
import type { GlobalMountOptions } from '@/__utils__/types';
import * as unexpectedErrorUtil from '@/utils/unexpected-error';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import UserPoliciesSidebarDetail from './user-policies-sidebar-detail.vue';

vi.mock('@/api', () => {
	return {
		default: {
			get: (path: string) => {
				throw new Error(`api.get ${JSON.stringify(path)} is not spied`);
			},
		},
	};
});

const userStoreState = vi.hoisted(() => {
	return { isAdmin: true };
});

vi.mock('@/stores/user', () => {
	return { useUserStore: () => userStoreState };
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
	messages: {
		en: {
			user_policy_sources: 'Policies and Sources',
			user_policy_sources_none: 'This user holds no policy',
			policy_source_direct: 'Attached to the user',
			policy_source_role: 'Role: {role}',
			policy_source_ancestor: 'Role: {role}, parent of {memberRole}',
		},
	},
});

const global: GlobalMountOptions = {
	stubs: {
		'sidebar-detail': { template: '<div><slot /></div>' },
		'v-progress-linear': true,
	},
	plugins: [i18n],
};

afterEach(() => {
	vi.restoreAllMocks();
	userStoreState.isAdmin = true;
});

test('shows nothing and reads nothing to a user who is no admin', async () => {
	userStoreState.isAdmin = false;

	vi.spyOn(api, 'get').mockResolvedValue({ data: { data: [] } });

	const wrapper = mount(UserPoliciesSidebarDetail, {
		props: { userId: 'user-1', memberRoleIds: ['role-editor'] },
		global,
	});

	await flushPromises();

	expect(api.get).not.toHaveBeenCalled();
	expect(wrapper.html()).toBe('<!--v-if-->');
});

test('shows a progress bar while the roles are read', async () => {
	vi.spyOn(api, 'get').mockReturnValue(new Promise(() => {}));

	const wrapper = mount(UserPoliciesSidebarDetail, {
		props: { userId: 'user-1', memberRoleIds: ['role-editor'] },
		global,
	});

	await flushPromises();

	expect(wrapper.find('v-progress-linear-stub').exists()).toBe(true);
	expect(wrapper.find('.no-policies').exists()).toBe(false);
});

test('lists a direct, a member role and an ancestor policy', async () => {
	const apiGetSpy = vi.spyOn(api, 'get')
		.mockResolvedValueOnce({
			data: {
				data: [
					{ id: 'role-editor', name: 'Editor', parent: 'role-staff' },
					{ id: 'role-staff', name: 'Staff', parent: null },
					{ id: 'role-other', name: 'Other', parent: null },
				],
			},
		})
		.mockResolvedValueOnce({
			data: {
				data: [
					{
						user: 'user-1',
						role: null,
						policy: { id: 'policy-direct', name: 'Direct Policy' },
					},
					{
						user: null,
						role: 'role-editor',
						policy: { id: 'policy-editor', name: 'Editor Policy' },
					},
					{
						user: null,
						role: 'role-staff',
						policy: { id: 'policy-staff', name: 'Staff Policy' },
					},
				],
			},
		});

	const wrapper = mount(UserPoliciesSidebarDetail, {
		props: { userId: 'user-1', memberRoleIds: ['role-editor'] },
		global,
	});

	await flushPromises();

	expect(apiGetSpy.mock.calls).toEqual([
		[
			'/roles',
			{
				params: {
					limit: -1,
					fields: ['id', 'name', 'parent'],
				},
			},
		],
		[
			'/access',
			{
				params: {
					limit: -1,
					fields: ['user', 'role', 'policy.id', 'policy.name'],
					filter: {
						_or: [
							{ user: { _eq: 'user-1' } },
							{ role: { _in: ['role-editor', 'role-staff'] } },
						],
					},
				},
			},
		],
	]);

	const policyRows = wrapper.findAll('.policy-source');

	expect(policyRows).toHaveLength(3);
	expect(policyRows[0]!.find('dt').text()).toBe('Direct Policy');
	expect(policyRows[0]!.find('dd').text()).toBe('Attached to the user');
	expect(policyRows[1]!.find('dt').text()).toBe('Editor Policy');
	expect(policyRows[1]!.find('dd').text()).toBe('Role: Editor');
	expect(policyRows[2]!.find('dt').text()).toBe('Staff Policy');

	expect(policyRows[2]!.find('dd').text())
		.toBe('Role: Staff, parent of Editor');

	expect(wrapper.find('v-progress-linear-stub').exists()).toBe(false);
});

test('a parent cycle stops the chain; no policy shows none', async () => {
	const apiGetSpy = vi.spyOn(api, 'get')
		.mockResolvedValueOnce({
			data: {
				data: [
					{ id: 'role-a', name: 'Role A', parent: 'role-b' },
					{ id: 'role-b', name: 'Role B', parent: 'role-a' },
				],
			},
		})
		.mockResolvedValueOnce({ data: { data: [] } });

	const wrapper = mount(UserPoliciesSidebarDetail, {
		props: { userId: 'user-1', memberRoleIds: ['role-a'] },
		global,
	});

	await flushPromises();

	expect(apiGetSpy).toHaveBeenLastCalledWith('/access', {
		params: {
			limit: -1,
			fields: ['user', 'role', 'policy.id', 'policy.name'],
			filter: {
				_or: [
					{ user: { _eq: 'user-1' } },
					{ role: { _in: ['role-a', 'role-b'] } },
				],
			},
		},
	});

	expect(wrapper.find('.no-policies').text())
		.toBe('This user holds no policy');

	expect(wrapper.find('dl').exists()).toBe(false);
});

test('two member roles sharing a parent read that parent once', async () => {
	const apiGetSpy = vi.spyOn(api, 'get')
		.mockResolvedValueOnce({
			data: {
				data: [
					{ id: 'role-editor', name: 'Editor', parent: 'role-staff' },
					{ id: 'role-writer', name: 'Writer', parent: 'role-staff' },
					{ id: 'role-staff', name: 'Staff', parent: null },
				],
			},
		})
		.mockResolvedValueOnce({ data: { data: [] } });

	mount(UserPoliciesSidebarDetail, {
		props: {
			userId: 'user-1',
			memberRoleIds: ['role-editor', 'role-writer'],
		},
		global,
	});

	await flushPromises();

	expect(apiGetSpy).toHaveBeenLastCalledWith('/access', {
		params: {
			limit: -1,
			fields: ['user', 'role', 'policy.id', 'policy.name'],
			filter: {
				_or: [
					{ user: { _eq: 'user-1' } },
					{ role: { _in: ['role-editor', 'role-staff', 'role-writer'] } },
				],
			},
		},
	});
});

test('a failed roles read goes to unexpectedError and ends loading', async () => {
	vi.spyOn(api, 'get').mockRejectedValueOnce(new Error('roles read failed'));

	const unexpectedErrorSpy = vi.spyOn(unexpectedErrorUtil, 'unexpectedError')
		.mockReturnValue();

	const wrapper = mount(UserPoliciesSidebarDetail, {
		props: { userId: 'user-1', memberRoleIds: ['role-editor'] },
		global,
	});

	await flushPromises();

	expect(unexpectedErrorSpy).toHaveBeenCalledExactlyOnceWith(
		new Error('roles read failed'),
	);

	expect(wrapper.find('v-progress-linear-stub').exists()).toBe(false);

	expect(wrapper.find('.no-policies').text())
		.toBe('This user holds no policy');
});
