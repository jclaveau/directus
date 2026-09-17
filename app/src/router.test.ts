import { useAppStore } from '@directus/stores';
import { createTestingPinia } from '@pinia/testing';
import { setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { Router, createMemoryHistory, createRouter } from 'vue-router';

const testComponent = defineComponent({
	render: () => h('div'),
});

const nonPublicRoutes = ['first', 'second', 'third'].map((route) => ({
	name: route,
	path: `/${route}`,
	component: testComponent,
	meta: {}, // make sure 'meta.public' is not set so that they are tracked
}));

let router: Router;
const authRefresh = vi.fn();
const userStoreTrackPage = vi.fn();
const userStore: Record<string, unknown> = { trackPage: userStoreTrackPage };

vi.mock('@/auth', () => ({
	refresh: authRefresh,
}));

vi.mock('@/hydrate', () => ({
	hydrate: vi.fn(),
}));

vi.mock('@/stores/server', () => ({
	useServerStore: vi.fn().mockReturnValue({
		info: {
			project: null,
		},
		hydrate: vi.fn(),
	}),
}));

vi.mock('@/stores/user', () => ({
	useUserStore: vi.fn().mockImplementation(() => userStore),
}));

beforeEach(async () => {
	setActivePinia(
		createTestingPinia({
			createSpy: vi.fn,
		}),
	);

	const importedRouter = await import('./router');

	router = createRouter({
		history: createMemoryHistory(), // intentionally use memory for tests
		routes: [...importedRouter.defaultRoutes, ...nonPublicRoutes],
	});

	router.beforeEach(importedRouter.onBeforeEach);
	router.afterEach(importedRouter.onAfterEach);
});

afterEach(() => {
	// Ensure the internal firstLoad variable in the imported router
	// is reset before every test
	vi.resetModules();

	delete userStore['currentUser'];
	delete userStore['impersonator'];
	vi.clearAllMocks();
});

describe('onBeforeEach', () => {
	test('should try retrieving a fresh access token on first load', async () => {
		router.push('/');
		await router.isReady();

		expect(authRefresh).toHaveBeenCalledOnce();
	});

	test('should not try retrieving a fresh access token after the first load', async () => {
		router.push('/');
		await router.isReady();

		// clear calls since there was an initial auth refresh
		authRefresh.mockClear();

		await router.push('/login');

		expect(authRefresh).not.toHaveBeenCalled();
	});

	test('should not try retrieving a fresh access token after the first load', async () => {
		router.push('/');
		await router.isReady();

		// clear calls since there was an initial auth refresh
		authRefresh.mockClear();

		await router.push('/login');

		expect(authRefresh).not.toHaveBeenCalled();
	});
});

describe('enforce_tfa', () => {
	beforeEach(() => {
		const appStore = useAppStore();
		appStore.hydrated = true;
		appStore.authenticated = true;

		userStore['currentUser'] = {
			enforce_tfa: true,
			tfa_secret: null,
			last_page: null,
		};
	});

	test('sends a user without a secret to the tfa setup', async () => {
		router.push('/');
		await router.isReady();

		await router.push('/first');

		expect(router.currentRoute.value.path).toBe('/tfa-setup');
	});

	test('is skipped under impersonation', async () => {
		userStore['impersonator'] = { id: 'admin' };
		router.push('/');
		await router.isReady();

		await router.push('/first');

		expect(router.currentRoute.value.path).toBe('/first');
	});
});

describe('onAfterEach', () => {
	beforeEach(() => {
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	test('should not trackPage for public routes', async () => {
		router.push('/');
		await router.isReady();

		expect(userStoreTrackPage).not.toHaveBeenCalled();
	});

	test('should only trackPage once when routing multiple times before the setTimeout duration ends', async () => {
		router.push('/');
		await router.isReady();

		// mock authenticated to prevent redirection back to login page
		const appStore = useAppStore();
		appStore.hydrated = true;
		appStore.authenticated = true;

		for (const route of nonPublicRoutes.map((route) => route.path)) {
			await router.push(route);
		}

		// advance past the trackTimeout duration
		vi.advanceTimersByTime(1000);
		expect(userStoreTrackPage).toHaveBeenCalledOnce();
	});
});
