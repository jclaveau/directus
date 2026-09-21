import { createTestingPinia } from '@pinia/testing';
import { setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { RouteLocationNormalized } from 'vue-router';

import api from '@/api';
import { AppUser } from '@/types/user';
import { Role, User, Globals } from '@directus/types';
import { useUserStore } from './user';

beforeEach(() => {
	setActivePinia(
		createTestingPinia({
			createSpy: vi.fn,
			stubActions: false,
		}),
	);
});

const mockUsersResponse = {
	id: '00000000-0000-0000-0000-000000000000',
	language: null,
	first_name: 'Test',
	last_name: 'User',
	email: 'test@example.com',
	last_page: null,
	tfa_secret: null,
	avatar: null,
	custom_user_field: 'test',
	role: {
		id: '00000000-0000-0000-0000-000000000000',
		custom_role_field: 'test',
	} as Partial<Role>,
	policies: [],
} as Partial<User>;

const mockGlobalsResponse = {
	app_access: true,
	admin_access: true,
	enforce_tfa: false,
} as Globals;

const mockRolesResponse: Pick<Role, 'id'>[] = [{ id: '00000000-0000-0000-0000-000000000000' }];

vi.mock('@/api', () => {
	return {
		default: {
			get: (path: string) => {
				switch (path) {
					case '/users/me':
						return Promise.resolve({
							data: {
								data: mockUsersResponse,
							},
						});
					case '/policies/me/globals':
						return Promise.resolve({
							data: {
								data: mockGlobalsResponse,
							},
						});
					case '/roles/me':
						return Promise.resolve({
							data: {
								data: mockRolesResponse,
							},
						});
				}

				return Promise.reject(new Error(`GET "${path}" is not mocked in this test`));
			},
			patch: vi.fn((path: string) => {
				if (path === '/users/me/track/page') {
					return Promise.resolve({
						data: {},
					});
				}

				return Promise.reject(new Error(`PATCH "${path}" is not mocked in this test`));
			}),
		},
	};
});

afterEach(() => {
	vi.clearAllMocks();
});

describe('getters', () => {
	describe('fullName', () => {
		test('should return null when there is no current user', async () => {
			const userStore = useUserStore();

			expect(userStore.fullName).toEqual(null);
		});

		test('should return concatenated first and last name when there is current user with first and last name', async () => {
			const userStore = useUserStore();
			await userStore.hydrate();

			expect(userStore.fullName).toEqual('Test User');
		});
	});

	describe('isAdmin', () => {
		test('should return false when there is no current user', async () => {
			const userStore = useUserStore();

			expect(userStore.isAdmin).toEqual(false);
		});

		test('should return false when current user has role with no admin access', async () => {
			const userStore = useUserStore();

			userStore.currentUser = {
				admin_access: false,
			} as AppUser;

			expect(userStore.isAdmin).toEqual(false);
		});

		test('should return true when current user has role with admin access', async () => {
			const userStore = useUserStore();

			userStore.currentUser = {
				admin_access: true,
			} as AppUser;

			expect(userStore.isAdmin).toEqual(true);
		});
	});
});

describe('actions', () => {
	describe('hydrate', () => {
		test('should fetch user fields and set current user as the returned value', async () => {
			const userStore = useUserStore();
			await userStore.hydrate();

			expect(userStore.currentUser).toEqual({ ...mockUsersResponse, ...mockGlobalsResponse, roles: mockRolesResponse });
		});
	});

	describe('trackPage', () => {
		const page = '/test';

		test('should not set last_page if there is no current user', async () => {
			const userStore = useUserStore();
			await userStore.trackPage({ path: page, fullPath: page } as RouteLocationNormalized);

			expect((userStore.currentUser as User)?.last_page).not.toBe(page);
		});

		test('should set last_page if there is current user', async () => {
			const userStore = useUserStore();
			await userStore.hydrate();
			await userStore.trackPage({ path: page, fullPath: page } as RouteLocationNormalized);

			expect((userStore.currentUser as User).last_page).toBe(page);
		});

		test('should not track the page the user is already on', async () => {
			const userStore = useUserStore();
			await userStore.hydrate();
			const route = { path: page, fullPath: page } as RouteLocationNormalized;
			await userStore.trackPage(route);
			await userStore.trackPage(route);

			expect(api.patch).toHaveBeenCalledTimes(1);
		});

		test('sends overlapping writes one at a time, in navigation order', async () => {
			const userStore = useUserStore();
			await userStore.hydrate();

			let land!: () => void;

			vi.mocked(api.patch).mockImplementationOnce(() => {
				return new Promise((resolve) => {
					land = () => resolve({ data: {} });
				});
			});

			const routeA = { path: '/a', fullPath: '/a' } as RouteLocationNormalized;
			const routeB = { path: '/b', fullPath: '/b' } as RouteLocationNormalized;
			const first = userStore.trackPage(routeA);
			const second = userStore.trackPage(routeB);

			// The first write is out and unanswered; the second waits behind it.
			await vi.waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));

			await Promise.resolve();
			expect(api.patch).toHaveBeenCalledTimes(1);

			land();
			await Promise.all([first, second]);

			expect(api.patch).toHaveBeenCalledTimes(2);

			expect(vi.mocked(api.patch).mock.calls.map(([, body]) => body)).toEqual([
				{ last_page: '/a' },
				{ last_page: '/b' },
			]);

			expect((userStore.currentUser as User).last_page).toBe('/b');
		});

		test('does not re-send a page whose write is still in flight', async () => {
			const userStore = useUserStore();
			await userStore.hydrate();

			let land!: () => void;

			vi.mocked(api.patch).mockImplementationOnce(() => {
				return new Promise((resolve) => {
					land = () => resolve({ data: {} });
				});
			});

			const route = { path: page, fullPath: page } as RouteLocationNormalized;
			const both = [userStore.trackPage(route), userStore.trackPage(route)];

			await vi.waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
			land();
			await Promise.all(both);

			expect(api.patch).toHaveBeenCalledTimes(1);
		});

		test('asks a page again after its write failed', async () => {
			const userStore = useUserStore();
			await userStore.hydrate();

			vi.mocked(api.patch).mockRejectedValueOnce(new Error('offline'));

			const route = { path: page, fullPath: page } as RouteLocationNormalized;
			await expect(userStore.trackPage(route)).rejects.toThrow('offline');
			await userStore.trackPage(route);

			expect(api.patch).toHaveBeenCalledTimes(2);
			expect((userStore.currentUser as User).last_page).toBe(page);
		});

		test('asks the page again after a dehydrate, for the next sign-in', async () => {
			const userStore = useUserStore();
			await userStore.hydrate();
			const route = { path: page, fullPath: page } as RouteLocationNormalized;
			await userStore.trackPage(route);

			await userStore.dehydrate();
			await userStore.hydrate();
			await userStore.trackPage(route);

			expect(api.patch).toHaveBeenCalledTimes(2);
		});
	});
});
