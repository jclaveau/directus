import { useServerStore } from '@/stores/server';

/**
 * Send /settings/marketplace/** to the extensions page where the API closes the
 * Marketplace (production).
 */
export async function redirectClosedMarketplace() {
	const serverStore = useServerStore();

	// Login starts the server hydrate without awaiting it.
	if (serverStore.info.extensions === undefined) {
		await serverStore.hydrate();
	}

	if (!serverStore.info.extensions?.marketplace) {
		return '/settings/extensions';
	}

	return true;
}
