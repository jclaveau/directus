<script setup lang="ts">
import api from '@/api';
import { useUserStore } from '@/stores/user';
import { unexpectedError } from '@/utils/unexpected-error';
import { userName } from '@/utils/user-name';
import { computed, ref } from 'vue';
import { useI18n } from 'vue-i18n';

const { t } = useI18n();

const userStore = useUserStore();

const stopping = ref(false);

const admin = computed(() => {
	return userStore.impersonator
		? userName(userStore.impersonator)
		: null;
});

async function stop() {
	stopping.value = true;

	try {
		await api.delete('/auth/impersonate');
		// Every store holds the target
		window.location.reload();
	}
	catch (error) {
		unexpectedError(error);
		stopping.value = false;
	}
}
</script>

<template>
	<div v-if="userStore.impersonator" class="impersonation-banner">
		<v-icon name="theater_comedy" />

		<span class="message">
			{{ t('impersonation_banner', { user: userStore.fullName, admin }) }}
		</span>

		<v-button x-small :loading="stopping" @click="stop">
			{{ t('stop_impersonation') }}
		</v-button>
	</div>
</template>

<style lang="scss" scoped>
.impersonation-banner {
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 6px 20px;
	color: var(--white);
	background-color: var(--theme--warning);

	.message {
		flex-grow: 1;
	}

	.v-button {
		--v-button-color: var(--theme--warning);
		--v-button-color-hover: var(--theme--warning);
		--v-button-background-color: var(--white);
		--v-button-background-color-hover: var(--white);
	}
}
</style>
