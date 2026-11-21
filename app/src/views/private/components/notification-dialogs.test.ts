import { generateRouter } from '@/__utils__/router';
import type { GlobalMountOptions } from '@/__utils__/types';
import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import { expect, test, vi } from 'vitest';
import { createI18n } from 'vue-i18n';
import NotificationDialogs from './notification-dialogs.vue';

vi.mock('@/api', () => {
	return {
		default: {
			get: (path: string) => {
				throw new Error(`api.get ${JSON.stringify(path)} is not mocked`);
			},
		},
	};
});

const i18n = createI18n({
	legacy: false,
	locale: 'en',
	missingWarn: false,
	fallbackWarn: false,
});

const slotStub = { template: '<div><slot /></div>' };

const stubs: GlobalMountOptions['stubs'] = {
	'v-dialog': slotStub,
	'v-card': slotStub,
	'v-card-title': slotStub,
	'v-card-text': slotStub,
	'v-card-actions': slotStub,
	'v-button': slotStub,
	'v-error': true,
};

test('the report error url renders each member role of the user', () => {
	const wrapper = mount(NotificationDialogs, {
		global: {
			stubs,
			plugins: [
				i18n,
				generateRouter(),
				createTestingPinia({
					createSpy: vi.fn,
					initialState: {
						userStore: {
							currentUser: {
								id: 'user-1',
								admin_access: true,
								roles: [
									{ id: 'membership-1', role: 'role-editor' },
									{
										id: 'membership-2',
										role: { id: 'role-staff', name: 'Staff' },
									},
								],
							},
						},
						settingsStore: {
							settings: {
								report_error_url: 'https://bugs.example.com/new'
									+ '?first={{roles.0.id}}:{{roles.0.name}}'
									+ '&second={{roles.1.id}}:{{roles.1.name}}',
							},
						},
						notificationsStore: {
							dialogs: [
								{
									id: 'notification-1',
									type: 'error',
									code: 'UNKNOWN',
									title: 'Something broke',
									dialog: true,
								},
							],
						},
					},
				}),
			],
		},
	});

	expect(wrapper.find('a').attributes('href')).toBe(
		'https://bugs.example.com/new'
			+ '?first=role-editor:&second=role-staff:Staff',
	);
});

test('a user without roles renders an empty roles list', () => {
	const wrapper = mount(NotificationDialogs, {
		global: {
			stubs,
			plugins: [
				i18n,
				generateRouter(),
				createTestingPinia({
					createSpy: vi.fn,
					initialState: {
						userStore: {
							currentUser: {
								id: 'user-1',
								admin_access: true,
								roles: [],
							},
						},
						settingsStore: {
							settings: {
								report_error_url: 'https://bugs.example.com/new'
									+ '?count={{roles.length}}',
							},
						},
						notificationsStore: {
							dialogs: [
								{
									id: 'notification-1',
									type: 'error',
									code: 'UNKNOWN',
									title: 'Something broke',
									dialog: true,
								},
							],
						},
					},
				}),
			],
		},
	});

	expect(wrapper.find('a').attributes('href'))
		.toBe('https://bugs.example.com/new?count=0');
});
