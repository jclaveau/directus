import { mockedStore } from '@/__utils__/store';
import { useServerStore } from '@/stores/server';
import { createTestingPinia } from '@pinia/testing';
import { setActivePinia } from 'pinia';
import { beforeEach, expect, test, vi } from 'vitest';
import { redirectClosedMarketplace } from './redirect-closed-marketplace';

beforeEach(() => {
	setActivePinia(createTestingPinia({ createSpy: vi.fn }));
});

test('sends a closed Marketplace to the extensions page', async () => {
	const serverStore = mockedStore(useServerStore());
	serverStore.info.extensions = { limit: null, marketplace: false };

	expect(await redirectClosedMarketplace()).toBe('/settings/extensions');
	expect(serverStore.hydrate).not.toHaveBeenCalled();
});

test('opens an open Marketplace', async () => {
	const serverStore = mockedStore(useServerStore());
	serverStore.info.extensions = { limit: null, marketplace: true };

	expect(await redirectClosedMarketplace()).toBe(true);
});

// Login starts the server hydrate without awaiting it, so a first visit can land
// here before `extensions` is read.
test('waits for the server info login has not awaited yet', async () => {
	const serverStore = mockedStore(useServerStore());

	serverStore.hydrate.mockImplementation(async () => {
		serverStore.info.extensions = { limit: null, marketplace: true };
	});

	expect(await redirectClosedMarketplace()).toBe(true);
	expect(serverStore.hydrate).toHaveBeenCalledOnce();
});
