import { useUserStore } from '@/stores/user';
import { createTestingPinia } from '@pinia/testing';
import { useAppStore } from '@directus/stores';
import { setActivePinia } from 'pinia';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const sdk = vi.hoisted(() => ({ request: vi.fn(), refresh: vi.fn() }));
vi.mock('@/sdk', () => ({ sdk }));
vi.mock('@/api', () => ({ resumeQueue: vi.fn() }));
vi.mock('@/hydrate', () => ({ hydrate: vi.fn(), dehydrate: vi.fn() }));
vi.mock('@/router', () => ({ router: { push: vi.fn() } }));

const { refresh } = await import('./auth');

const reload = vi.fn();

beforeEach(() => {
	setActivePinia(createTestingPinia({ createSpy: vi.fn }));
	vi.stubGlobal('location', { reload });

	const appStore = useAppStore();
	appStore.authenticated = true;
	appStore.accessTokenExpiry = Date.now() + 60 * 60_000;

	useUserStore().currentUser = { id: 'jane' } as never;
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

test('a fresh token is only validated', async () => {
	sdk.request.mockResolvedValue({ id: 'jane' });

	await refresh();

	expect(sdk.request).toHaveBeenCalledTimes(1);
	expect(sdk.refresh).not.toHaveBeenCalled();
	expect(reload).not.toHaveBeenCalled();
});

test('another tab changed who the session runs as: reload', async () => {
	sdk.request.mockResolvedValue({ id: 'admin' });

	await refresh();

	expect(reload).toHaveBeenCalledTimes(1);
});
