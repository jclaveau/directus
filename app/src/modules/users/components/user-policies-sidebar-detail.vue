<script setup lang="ts">
import api from '@/api';
import { useUserStore } from '@/stores/user';
import { unexpectedError } from '@/utils/unexpected-error';
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
	type AccessLink,
	listPolicySources,
	type PolicySource,
	type RoleLink,
} from '../utils/list-policy-sources';

const props = defineProps<{
	userId: string;
	memberRoleIds: string[];
}>();

const { t } = useI18n();

// Reading `directus_access` is an admin's right: anyone else would get a 403.
const userStore = useUserStore();

const policySources = ref<PolicySource[]>([]);
const loading = ref(false);

watch(
	[() => props.userId, () => props.memberRoleIds],
	fetchPolicySources,
	{ immediate: true },
);

async function fetchPolicySources() {
	if (!userStore.isAdmin) {
		return;
	}

	loading.value = true;

	try {
		const rolesResponse = await api.get('/roles', {
			params: {
				limit: -1,
				fields: ['id', 'name', 'parent'],
			},
		});

		const allRoles: RoleLink[] = rolesResponse.data.data;
		const chainRoleIds = collectChainRoleIds(allRoles, props.memberRoleIds);

		const accessResponse = await api.get('/access', {
			params: {
				limit: -1,
				fields: ['user', 'role', 'policy.id', 'policy.name'],
				filter: {
					_or: [
						{ user: { _eq: props.userId } },
						{ role: { _in: chainRoleIds } },
					],
				},
			},
		});

		const accessRows: AccessLink[] = accessResponse.data.data;

		policySources.value = listPolicySources(
			props.userId,
			props.memberRoleIds,
			allRoles,
			accessRows,
		);
	}
	catch (error) {
		unexpectedError(error);
	}
	finally {
		loading.value = false;
	}
}

function collectChainRoleIds(allRoles: RoleLink[], memberRoleIds: string[]) {
	const parentById = new Map(allRoles.map((role) => [role.id, role.parent]));
	const chainRoleIds = new Set<string>();

	for (const memberRoleId of memberRoleIds) {
		let roleId: string | null | undefined = memberRoleId;

		while (roleId && !chainRoleIds.has(roleId)) {
			chainRoleIds.add(roleId);
			roleId = parentById.get(roleId);
		}
	}

	return [...chainRoleIds];
}

function describeSource(policySource: PolicySource) {
	if (policySource.source === 'direct') {
		return t('policy_source_direct');
	}

	if (policySource.source === 'role') {
		return t('policy_source_role', { role: policySource.role.name });
	}

	return t('policy_source_ancestor', {
		role: policySource.role.name,
		memberRole: policySource.memberRole.name,
	});
}
</script>

<template>
	<sidebar-detail
		v-if="userStore.isAdmin"
		icon="policy"
		:title="t('user_policy_sources')"
	>
		<v-progress-linear v-if="loading" indeterminate />
		<p v-else-if="policySources.length === 0" class="no-policies">
			{{ t('user_policy_sources_none') }}
		</p>
		<dl v-else>
			<div
				v-for="(policySource, index) in policySources"
				:key="index"
				class="policy-source"
			>
				<dt>{{ policySource.policy.name }}</dt>
				<dd>{{ describeSource(policySource) }}</dd>
			</div>
		</dl>
	</sidebar-detail>
</template>

<style lang="scss" scoped>
.no-policies {
	color: var(--theme--foreground-subdued);
}

.policy-source + .policy-source {
	margin-block-start: 8px;
}

dd {
	color: var(--theme--foreground-subdued);
}
</style>
