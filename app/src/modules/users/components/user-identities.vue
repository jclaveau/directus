<script setup lang="ts">
import api from '@/api';
import { useServerStore } from '@/stores/server';
import { getRootPath } from '@/utils/get-root-path';
import { unexpectedError } from '@/utils/unexpected-error';
import formatTitle from '@directus/format-title';
import type { UserIdentity } from '@directus/types';
import { computed, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';

type ShownIdentity = Pick<UserIdentity, 'id' | 'kind' | 'value' | 'verified'>;

const EMAIL_KIND = 'email';

// SAML cannot link an identity to a logged-in account
const LINKING_SSO_DRIVERS = ['oauth2', 'openid'];

const { t } = useI18n();

const serverStore = useServerStore();

const userIdentities = ref<ShownIdentity[]>([]);
const primaryIdentity = ref<string | null>(null);
const removingIdentity = ref<string | null>(null);

const linkingProviders = computed(() => {
	return serverStore.auth.providers
		.filter((provider) => LINKING_SSO_DRIVERS.includes(provider.driver))
		.map((provider) => {
			const linkUrl = new URL(window.location.origin);
			linkUrl.pathname = `${getRootPath()}auth/login/${provider.name}`;
			linkUrl.searchParams.set('link', 'true');
			linkUrl.searchParams.set('redirect', window.location.href);

			return {
				name: provider.name,
				label: provider.label || formatTitle(provider.name),
				icon: provider.icon ?? 'account_circle',
				link: linkUrl.toString(),
			};
		});
});

onMounted(fetchIdentities);

function identityIcon(identityKind: string) {
	return identityKind === EMAIL_KIND
		? 'alternate_email'
		: 'account_circle';
}

function identityKindName(identityKind: string) {
	return identityKind === EMAIL_KIND
		? t('email')
		: formatTitle(identityKind);
}

async function fetchIdentities() {
	try {
		const response = await api.get('/users/me', {
			params: {
				fields: [
					'primary_identity',
					'identities.id',
					'identities.kind',
					'identities.value',
					'identities.verified',
				],
			},
		});

		userIdentities.value = response.data.data.identities;
		primaryIdentity.value = response.data.data.primary_identity;
	}
	catch (error) {
		unexpectedError(error);
	}
}

async function removeIdentity(identityId: string) {
	removingIdentity.value = identityId;

	try {
		await api.delete(`/users/me/identities/${identityId}`);
		await fetchIdentities();
	}
	catch (error) {
		unexpectedError(error);
	}
	finally {
		removingIdentity.value = null;
	}
}
</script>

<template>
	<div class="user-identities">
		<p class="type-label">{{ t('fields.directus_users.identities') }}</p>

		<div
			v-for="userIdentity in userIdentities"
			:key="userIdentity.id"
			class="identity"
			:data-identity="userIdentity.id"
		>
			<v-icon :name="identityIcon(userIdentity.kind)" small />
			<span class="kind">{{ identityKindName(userIdentity.kind) }}</span>
			<span v-if="userIdentity.value" class="value">{{ userIdentity.value }}</span>
			<span v-else class="value hidden">{{ t('hidden') }}</span>
			<v-chip v-if="userIdentity.id === primaryIdentity" class="primary" small>
				{{ t('primary') }}
			</v-chip>
			<v-chip v-if="userIdentity.verified" class="verified" small>
				{{ t('verified') }}
			</v-chip>
			<v-button
				v-tooltip="t('remove')"
				class="remove"
				icon
				x-small
				secondary
				:loading="removingIdentity === userIdentity.id"
				@click="removeIdentity(userIdentity.id)"
			>
				<v-icon name="close" small />
			</v-button>
		</div>

		<div v-if="linkingProviders.length > 0" class="linking-providers">
			<v-button
				v-for="provider in linkingProviders"
				:key="provider.name"
				class="link-provider"
				:href="provider.link"
				secondary
				small
			>
				<v-icon :name="provider.icon" left small />
				{{ t('link_identity_with', { provider: provider.label }) }}
			</v-button>
		</div>
	</div>
</template>

<style lang="scss" scoped>
.user-identities {
	max-inline-size: calc(var(--form-column-max-width) * 2 + var(--theme--form--column-gap));
	margin-block-end: var(--theme--form--row-gap);
}

.type-label {
	margin-block-end: 8px;
}

.identity {
	display: flex;
	gap: 8px;
	align-items: center;
	padding-block: 4px;

	.kind {
		font-weight: 600;
	}

	.hidden {
		color: var(--theme--foreground-subdued);
		font-style: italic;
	}

	.remove {
		margin-inline-start: auto;
	}
}

.linking-providers {
	display: flex;
	flex-wrap: wrap;
	gap: 8px;
	margin-block-start: 8px;
}
</style>
