import api, { RequestConfig } from '@/api';
import { RTL_LANGUAGES } from '@/constants/text-direction';
import { setLanguage } from '@/lang/set-language';
import { useServerStore } from '@/stores/server';
import { AppUser, ShareUser } from '@/types/user';
import { userName } from '@/utils/user-name';
import { isIn } from '@directus/utils';
import { merge } from 'lodash';
import { defineStore } from 'pinia';
import { computed, ref, unref, watch } from 'vue';
import type { RouteLocationNormalized } from 'vue-router';

export const useUserStore = defineStore('userStore', () => {
	const serverStore = useServerStore();

	const currentUser = ref<AppUser | ShareUser | null>(null);
	const loading = ref(false);
	const error = ref(null);

	const fullName = computed(() => {
		const user = unref(currentUser);
		if (user === null || 'share' in user) return null;
		return userName(user);
	});

	const isAdmin = computed(() => unref(currentUser)?.admin_access === true || false);

	const language = computed(() => {
		const user = unref(currentUser);

		if (user && 'language' in user && user.language !== null) {
			return user.language;
		}

		if (serverStore.info?.project?.default_language) {
			return serverStore.info.project.default_language;
		}

		return 'en-US';
	});

	watch(language, (newLang, oldLang) => {
		if (newLang && newLang !== oldLang) {
			setLanguage(newLang);
		}
	});

	const textDirection = computed(() => {
		const user = unref(currentUser);
		const lang = unref(language);

		const savedDir = (user && 'text_direction' in user && user.text_direction) ?? 'auto';

		let dir: 'ltr' | 'rtl';

		if (savedDir === 'ltr' || savedDir === 'rtl') {
			dir = savedDir;
		} else {
			dir = isIn(lang, RTL_LANGUAGES) ? 'rtl' : 'ltr';
		}

		return dir;
	});

	const hydrate = async () => {
		loading.value = true;

		try {
			const fields = ['*', 'role.id'];

			const [{ data: user }, { data: globals }, { data: roles }] = await Promise.all([
				api.get('/users/me', { params: { fields } }),
				api.get('/policies/me/globals'),
				api.get('/roles/me', { params: { fields: ['id'] } }),
			]);

			currentUser.value = {
				...user.data,
				...(user.data?.avatar != null ? { avatar: { id: user.data?.avatar } } : {}),
				...globals.data,
				roles: roles.data,
			};
		} catch (error: any) {
			error.value = error;
		} finally {
			loading.value = false;
		}
	};

	const dehydrate = async () => {
		currentUser.value = null;
		requestedPage = null;
		loading.value = false;
		error.value = null;
	};

	const hydrateAdditionalFields = async (fields: string[]) => {
		try {
			const { data } = await api.get('/users/me', { params: { fields } });

			currentUser.value = merge({}, unref(currentUser), data.data);
		} catch {
			// Do nothing
		}
	};

	// The page the latest write asked for. `currentUser.last_page` only follows a
	// write that landed, so it is what the row is expected to hold, and a failed
	// write hands the page back to be asked again.
	let requestedPage: string | null = null;

	// One write in flight, in navigation order: two overlapping ones can land on
	// the server in either order, and the row would keep the older page.
	let tracking: Promise<void> = Promise.resolve();

	const trackPage = async (to: RouteLocationNormalized) => {
		/**
		 * We don't want to track the full screen preview from live previews as part of the user's
		 * last page, as that'll cause a fresh login to navigate to the full screen preview where
		 * you can't navigate away from #19160
		 */
		if (to.path.endsWith('/preview')) {
			return;
		}

		const page = to.fullPath;
		const user = unref(currentUser);

		const trackedPage = user && !('share' in user)
			? user.last_page
			: null;

		// A reload or the login redirect lands on the page already tracked: the
		// write would only purge the user's cached reads for nothing.
		if ((requestedPage ?? trackedPage) === page) {
			return;
		}

		const previousPage = requestedPage;
		requestedPage = page;

		tracking = tracking
			.catch(() => {})
			.then(() => {
				return api.patch(
					'/users/me/track/page',
					{
						last_page: page,
					},
					{ measureLatency: true } as RequestConfig,
				);
			})
			.then(() => {
				const user = unref(currentUser);

				if (user && !('share' in user)) {
					user.last_page = page;
				}
			})
			.catch((error) => {
				if (requestedPage === page) {
					requestedPage = previousPage;
				}

				throw error;
			});

		await tracking;
	};

	return {
		currentUser,
		loading,
		error,
		fullName,
		isAdmin,
		language,
		textDirection,
		hydrate,
		dehydrate,
		hydrateAdditionalFields,
		trackPage,
	};
});
