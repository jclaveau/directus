import api from '@/api';
import { i18n } from '@/lang';
import { useNotificationsStore } from '@/stores/notifications';
import { useUserStore } from '@/stores/user';

/** What the app chunk exports beside its entries, once the server built it. */
export interface AppChunkStamp {
	chunkHash?: string;
	bundleEntries?: {
		source: string;
		folder: string;
		entries: { type: string; name: string }[];
	}[];
}

let staleNoticeShown = false;

function notifyStaleAppChunk(): void {
	if (staleNoticeShown) {
		return;
	}

	staleNoticeShown = true;

	useNotificationsStore().add({
		title: i18n.global.t('reload_required'),
		text: i18n.global.t('extension_app_chunk_stale_copy'),
		type: 'warning',
		dialog: false,
		persist: true,
		alwaysShowText: true,
		dismissIcon: 'refresh',
		dismissText: i18n.global.t('extension_reload_now'),
		dismissAction: () => {
			window.location.reload();
		},
	});
}

/**
 * Hands the server the app entries of the bundles declaring their entries in
 * code: it never runs their `app.js`, so only the app can read them. An admin
 * reports them, since the rows they become are settings.
 */
export async function reportAppEntries(appChunk: AppChunkStamp): Promise<void> {
	if (appChunk.chunkHash === undefined || appChunk.bundleEntries === undefined) {
		return;
	}

	if (!useUserStore().isAdmin) {
		return;
	}

	try {
		await api.post('/extensions/app-entries', {
			chunk: appChunk.chunkHash,
			entries: appChunk.bundleEntries,
		});
	}
	catch (error: any) {
		if (error?.response?.status === 409) {
			notifyStaleAppChunk();
			return;
		}

		// eslint-disable-next-line no-console
		console.warn(`Couldn't report the app entries of the bundles`, error);
	}
}

/**
 * Tells the user to reload once the server serves another app chunk than the
 * one this tab runs, checked whenever the tab comes back into view.
 */
export function watchAppChunk(appChunk: AppChunkStamp): () => void {
	const runningHash = appChunk.chunkHash;

	if (runningHash === undefined) {
		return () => {};
	}

	const checkAppChunk = async () => {
		if (document.visibilityState !== 'visible') {
			return;
		}

		try {
			const response = await api.get('/extensions/app-chunk');

			if (response.data.data.chunk !== runningHash) {
				notifyStaleAppChunk();
			}
		}
		catch (error) {
			// eslint-disable-next-line no-console
			console.warn(`Couldn't read the app chunk the server serves`, error);
		}
	};

	document.addEventListener('visibilitychange', checkAppChunk);

	return () => document.removeEventListener('visibilitychange', checkAppChunk);
}
