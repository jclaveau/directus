import api from '@/api';
import { unexpectedError } from '@/utils/unexpected-error';
import { ref } from 'vue';

export type ImpersonationMode = 'cookie' | 'session';

// Anything else in project_url would run in the tab, as a page the admin opened
const WEB_URL = /^https?:\/\//i;

/**
 * Start an impersonation from the Data Studio. Cookie mode sends the project
 * website to a new tab, opened on the click itself: one opened after the
 * request answers is a popup to the browser; opened without an opener, the
 * website gets no handle on the Data Studio. Session mode reloads, every
 * store holds the admin.
 */
export function useImpersonate() {
	const impersonating = ref(false);

	async function impersonate(
		user: string,
		mode: ImpersonationMode,
		projectUrl: string | null,
	): Promise<boolean> {
		if (impersonating.value) {
			return false;
		}

		if (mode === 'cookie' && !WEB_URL.test(projectUrl ?? '')) {
			unexpectedError(new Error(`Not a web URL to send the tab to: ${projectUrl}`));
			return false;
		}

		impersonating.value = true;

		const tab = mode === 'cookie'
			? window.open('', '_blank')
			: null;

		if (tab) {
			tab.opener = null;
		}

		try {
			await api.post('/auth/impersonate', { user, mode });

			if (mode === 'session') {
				window.location.reload();
			}
			else if (tab) {
				tab.location.href = projectUrl as string;
			}

			return true;
		}
		catch (error) {
			tab?.close();
			unexpectedError(error);
			return false;
		}
		finally {
			impersonating.value = false;
		}
	}

	return { impersonating, impersonate };
}
