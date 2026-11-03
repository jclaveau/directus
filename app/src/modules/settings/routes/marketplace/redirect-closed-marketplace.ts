import { useServerStore } from '@/stores/server';

/**
 * Send /settings/marketplace/** to the extensions page where the API closes the
 * Marketplace (production).
 */
export function redirectClosedMarketplace() {
	if (!useServerStore().info.extensions?.marketplace) {
		return '/settings/extensions';
	}

	return true;
}
