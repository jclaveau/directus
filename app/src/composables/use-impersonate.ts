import api from '@/api';
import { unexpectedError } from '@/utils/unexpected-error';
import { ref } from 'vue';

export type ImpersonationMode = 'cookie' | 'session';

/**
 * Start an impersonation from the Data Studio. Cookie mode sends the project
 * website to a new tab, opened on the click itself: one opened after the
 * request answers is a popup to the browser. Session mode reloads, every
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

		impersonating.value = true;

		const tab = mode === 'cookie'
			? window.open('', '_blank')
			: null;

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
