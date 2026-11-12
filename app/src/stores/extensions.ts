import api from '@/api';
import type { ApiOutput } from '@directus/types';
import { APP_OR_HYBRID_EXTENSION_TYPES } from '@directus/constants';
import { isIn } from '@directus/utils';
import { isEqual } from 'lodash';
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { useNotificationsStore } from './notifications';

const getEnabledBrowserExtensions = (extensions: ApiOutput[]) => {
	const enabledIds: string[] = [];

	for (const extension of extensions) {
		if (!extension.schema || !extension.schema.type) continue;

		if (isIn(extension.schema.type, APP_OR_HYBRID_EXTENSION_TYPES) && extension.meta.enabled) {
			enabledIds.push(extension.id);
		}

		if (extension.schema.type === 'bundle') {
			const nested = extensions.filter((child) => child.bundle === extension.id);
			const enabled = getEnabledBrowserExtensions(nested);

			enabledIds.push(...enabled);

			if (extension.schema.partial === false && enabled.length > 0) {
				enabledIds.push(extension.id);
			}
		}
	}

	return enabledIds;
};

export const useExtensionsStore = defineStore('extensions', () => {
	const notificationsStore = useNotificationsStore();
	const { t } = useI18n();

	const loading = ref(false);
	const error = ref<unknown>(null);
	const extensions = ref<ApiOutput[]>([]);
	const reloadNotificationVisible = ref(false);

	const notifyReloadRequired = () => {
		if (reloadNotificationVisible.value) {
			return;
		}

		notificationsStore.add({
			id: 'reload-required',
			title: t('reload_required'),
			text: t('extension_reload_required_copy'),
			type: 'warning',
			dialog: false,
			persist: true,
			alwaysShowText: true,
			dismissIcon: 'refresh',
			dismissText: t('extension_reload_now'),
			dismissAction: () => {
				window.location.reload();
			},
		});

		reloadNotificationVisible.value = true;
	};

	const refresh = async (forceRefresh = true) => {
		loading.value = true;

		const currentlyEnabledBrowserExtensions = getEnabledBrowserExtensions(extensions.value);

		try {
			const response = await api.get('/extensions');
			extensions.value = response.data.data;

			const newEnabledBrowserExtensions = getEnabledBrowserExtensions(extensions.value);

			if (
				forceRefresh &&
				isEqual(currentlyEnabledBrowserExtensions, newEnabledBrowserExtensions) === false &&
				!reloadNotificationVisible.value
			) {
				notifyReloadRequired();
			}
		} catch (err) {
			error.value = err;
		} finally {
			loading.value = false;
		}
	};

	const toggleState = async (id: string) => {
		const extension = extensions.value.find((ext) => ext.id === id);

		if (!extension) throw new Error(`Extension with ID ${id} does not exist`);

		const current = extension.meta.enabled;
		const endpoint = `/extensions/${id}`;

		await api.patch(endpoint, { meta: { enabled: !current } });

		await refresh();
	};

	// An entry of a bundle declaring its entries in code may have no row yet.
	const toggleEntryState = async (entry: ApiOutput) => {
		await api.patch(`/extensions/${entry.bundle}/entries/${entry.meta.folder}`, {
			meta: { enabled: !entry.meta.enabled },
		});

		await refresh();

		const entryType = entry.schema?.type;

		if (entryType && isIn(entryType, APP_OR_HYBRID_EXTENSION_TYPES)) {
			notifyReloadRequired();
		}
	};

	const install = async (extensionId: string, versionId: string) => {
		await api.post('/extensions/registry/install', { extension: extensionId, version: versionId });
		await refresh();
	};

	const uninstall = async (extensionId: string) => {
		await api.delete(`/extensions/registry/uninstall/${extensionId}`);
		await refresh();
	};

	const reinstall = async (extensionId: string) => {
		await api.post(`/extensions/registry/reinstall`, { extension: extensionId });
		await refresh();
	};

	const remove = async (extensionId: string) => {
		await api.delete(`/extensions/${extensionId}`);
		await refresh();
	};

	const extensionIds = computed(() => extensions.value.map((ext) => ext.id));

	refresh(false);

	return {
		extensions,
		extensionIds,
		loading,
		error,
		refresh,
		toggleState,
		toggleEntryState,
		install,
		uninstall,
		reinstall,
		remove,
	};
});
