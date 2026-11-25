<script setup lang="ts">
import { useImpersonate } from '@/composables/use-impersonate';
import { useSettingsStore } from '@/stores/settings';
import { useUserStore } from '@/stores/user';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const props = defineProps<{
	/** The user the page shows; null while it is new or still loading */
	userId: string | null;
	title: string;
}>();

const { t } = useI18n();

const userStore = useUserStore();
const settingsStore = useSettingsStore();

const confirmImpersonate = ref(false);
const { impersonating, impersonate } = useImpersonate();

const impersonateAllowed = computed(() => {
	if (!userStore.impersonationAvailable || !userStore.isAdmin) {
		return false;
	}

	const me = userStore.currentUser;

	if (userStore.impersonator || !props.userId || !me || 'share' in me) {
		return false;
	}

	return props.userId !== me.id;
});

const projectUrl = computed(() => settingsStore.settings?.project_url ?? null);

async function impersonateAs(mode: 'cookie' | 'session') {
	if (await impersonate(props.userId!, mode, projectUrl.value)) {
		confirmImpersonate.value = false;
	}
}
</script>

<template>
	<v-dialog
		v-if="impersonateAllowed"
		v-model="confirmImpersonate"
		@esc="confirmImpersonate = false"
	>
		<template #activator="{ on }">
			<v-button
				v-tooltip.bottom="t('impersonate')"
				rounded
				icon
				secondary
				@click="on"
			>
				<v-icon name="theater_comedy" />
			</v-button>
		</template>

		<v-card>
			<v-card-title>
				{{ t('impersonate_confirm', { user: title }) }}
			</v-card-title>
			<v-card-text>{{ t('impersonate_explain') }}</v-card-text>

			<v-card-actions>
				<v-button secondary @click="confirmImpersonate = false">
					{{ t('cancel') }}
				</v-button>
				<v-button
					v-tooltip.bottom="
						projectUrl
							? t('impersonate_in_project_website_hint')
							: t('impersonate_no_project_url')
					"
					secondary
					:disabled="!projectUrl"
					:loading="impersonating"
					@click="impersonateAs('cookie')"
				>
					{{ t('impersonate_in_project_website') }}
				</v-button>
				<v-button
					kind="warning"
					:loading="impersonating"
					@click="impersonateAs('session')"
				>
					{{ t('impersonate_in_data_studio') }}
				</v-button>
			</v-card-actions>
		</v-card>
	</v-dialog>
</template>
