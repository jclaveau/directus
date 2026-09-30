<script setup lang="ts">
import api from '@/api';
import { computed, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import {
	type CacheSettingRow,
	cacheSettingRows,
	type CacheSettingsAnswer,
	type CacheSettingSource,
	cacheSettingsStamp,
	parseCacheSettingValue,
} from './cache-settings-panel';

const props = defineProps<{
	/** Bumped by the page on each refresh, which re-reads the settings. */
	refreshKey?: number;
}>();

const emit = defineEmits<{ changed: [] }>();

const { t } = useI18n();

const answer = ref<CacheSettingsAnswer | null>(null);
const error = ref<string | null>(null);
const saving = ref(false);
const drafts = ref<Record<string, string | null>>({});

// A number field holding what the browser cannot read reports it as emptied,
// which would write a reset, so the fields in that state are kept apart, with
// the box that holds it.
const badInputFields = ref(new Map<string, HTMLInputElement>());

// Bumped to give a field a new box: one whose value is null renders '' before
// and after its unreadable text is discarded, so only a new box drops it.
const inputGenerations = ref<Record<string, number>>({});

const rows = computed(() => cacheSettingRows(answer.value));

/**
 * The stamp as one sentence, worded as the autoscale panel words its own, and
 * assembled here rather than out of template fragments, which drop the spaces
 * between them the moment one of the fragments is conditional.
 */
const stampLine = computed(() => {
	const stamp = cacheSettingsStamp(answer.value, Date.now());

	if (stamp === null) {
		return null;
	}

	const parts = [t('cache_settings_set_by', 'Configured')];

	if (stamp.setBy !== null) {
		parts.push(`by ${stamp.setBy}`);
	}

	if (stamp.setFrom === 'admin') {
		parts.push(`from ${t('cache_settings_from_admin', 'the admin')}`);
	}

	if (stamp.setFrom === 'mcp') {
		parts.push(`from ${t('cache_settings_from_mcp', 'the system MCP')}`);
	}

	parts.push(`${stamp.days}${t('cache_settings_days_ago', 'd ago')}`);

	return parts.join(' ');
});

const dirty = computed(() => Object.keys(drafts.value).length > 0);

onMounted(load);

watch(() => props.refreshKey, load);

async function load(): Promise<void> {
	try {
		const response = await api.get('/utils/cache/settings');
		answer.value = response.data.data;
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
	}
}

/** Whether the write landed, so a refused one leaves the typing to fix. */
async function write(
	request: () => Promise<{ data: { data: CacheSettingsAnswer } }>,
): Promise<boolean> {
	saving.value = true;
	error.value = null;

	try {
		const response = await request();
		answer.value = response.data.data;

		// Switching the cache on can clear it, which the page's figures show.
		emit('changed');
		return true;
	}
	catch (err: any) {
		error.value = err?.response?.data?.errors?.[0]?.message ?? String(err);
		return false;
	}
	finally {
		saving.value = false;
	}
}

function writePatch(patch: Record<string, unknown>): Promise<boolean> {
	return write(() => api.patch('/utils/cache/settings', patch));
}

function edited(field: string): boolean {
	return field in drafts.value;
}

/**
 * Which layer the value in the box would come from: a field being typed into
 * lands in the settings, and one emptied names no layer until it lands.
 */
function sourceOf(row: CacheSettingRow): CacheSettingSource | null {
	if (edited(row.field) === false) {
		return row.source;
	}

	const draft = drafts.value[row.field];

	return draft === null || draft === ''
		? null
		: 'settings';
}

function sourceLabel(source: CacheSettingSource | null): string {
	if (source === null) {
		return '—';
	}

	if (source === 'settings') {
		return t('cache_settings_source_settings', 'shared settings');
	}

	return t('cache_settings_source_env', 'environment');
}

/** The change being typed, else what the node runs on. */
function shown(row: CacheSettingRow): string | null {
	if (edited(row.field)) {
		return drafts.value[row.field] ?? null;
	}

	return row.value === null
		? null
		: String(row.value);
}

function trackBadInput(field: string, event: Event): void {
	const fieldInput = event.target as HTMLInputElement;

	if (fieldInput.validity.badInput) {
		badInputFields.value.set(field, fieldInput);
	}
	else {
		badInputFields.value.delete(field);
	}
}

/**
 * Take a value the box reports. A number's arrows step it without an input
 * event, so the box is asked again whether it still holds unreadable text.
 */
function updateDraft(field: string, value: string | null): void {
	drafts.value[field] = value;

	if (badInputFields.value.get(field)?.validity.badInput === false) {
		badInputFields.value.delete(field);
	}
}

function inputKey(field: string): string {
	return `${field}:${inputGenerations.value[field] ?? 0}`;
}

/** Refuse the write while one of `rows` holds what the browser cannot read. */
function refusesBadInput(rows: CacheSettingRow[]): boolean {
	const unreadable = rows.filter((row) => badInputFields.value.has(row.field));

	if (unreadable.length === 0) {
		return false;
	}

	error.value = `${t('not_a_number')}: ${
		unreadable.map((row) => row.variable).join(', ')
	}`;

	return true;
}

function forgetDraft(field: string): void {
	delete drafts.value[field];

	if (badInputFields.value.delete(field)) {
		inputGenerations.value[field] = (inputGenerations.value[field] ?? 0) + 1;
	}
}

async function applyRow(row: CacheSettingRow): Promise<void> {
	if (edited(row.field) === false || refusesBadInput([row])) {
		return;
	}

	const value = parseCacheSettingValue(row.kind, drafts.value[row.field]);

	if (await writePatch({ [row.field]: value })) {
		forgetDraft(row.field);
	}
}

function cancelRow(field: string): void {
	forgetDraft(field);
}

async function resetRow(field: string): Promise<void> {
	if (await writePatch({ [field]: null })) {
		forgetDraft(field);
	}
}

/** Every pending change in one write, refused or taken whole. */
async function applyAll(): Promise<void> {
	const patch: Record<string, unknown> = {};

	if (refusesBadInput(rows.value.filter((row) => edited(row.field)))) {
		return;
	}

	for (const row of rows.value) {
		if (edited(row.field)) {
			patch[row.field] = parseCacheSettingValue(row.kind, drafts.value[row.field]);
		}
	}

	if (await writePatch(patch) === false) {
		return;
	}

	for (const field of Object.keys(patch)) {
		forgetDraft(field);
	}
}

function resetAll(): void {
	for (const field of Object.keys(drafts.value)) {
		forgetDraft(field);
	}
}

async function resetToFallbacks(): Promise<void> {
	if (await write(() => api.delete('/utils/cache/settings'))) {
		resetAll();
	}
}

/** What resetting a field would leave it on, named in the button that does it. */
function resetsTo(row: CacheSettingRow): string {
	const back = t('cache_settings_reset_env', 'Reset to the environment:');

	return row.fallback === null
		? `${back} —`
		: `${back} ${String(row.fallback)}`;
}
</script>

<template>
	<div class="cache-settings">
		<v-notice v-if="error" type="danger">{{ error }}</v-notice>

		<table class="fields">
			<thead>
				<tr>
					<th>{{ t('cache_settings_field', 'Field') }}</th>
					<th>{{ t('cache_settings_value', 'Value') }}</th>
				</tr>
			</thead>
			<tbody>
				<tr v-for="row in rows" :key="row.field">
					<td>
						<span v-tooltip="row.description">{{ row.variable }}</span>
					</td>
					<td class="edit">
						<!-- `v-select`'s own root has no layout box, so the cell's flex
						row lays this span out instead. -->
						<span
							v-if="row.options"
							class="control choice"
							:class="{ pending: edited(row.field) }"
						>
							<v-select
								:model-value="shown(row)"
								:items="row.options"
								small
								:disabled="saving"
								@update:model-value="updateDraft(row.field, $event)"
							>
								<template #append>
									<span class="source" :class="{ pending: edited(row.field) }">
										{{ sourceLabel(sourceOf(row)) }}
									</span>
								</template>
							</v-select>
						</span>

						<span
							v-else
							class="control"
							:class="{
								numeric: row.kind === 'number',
								pending: edited(row.field),
							}"
						>
							<v-input
								:key="inputKey(row.field)"
								:model-value="shown(row) ?? ''"
								small
								full-width
								:type="row.kind === 'number' ? 'number' : 'text'"
								:min="row.min"
								:step="row.step"
								:suffix="row.unit"
								:disabled="saving"
								:aria-label="row.variable"
								@update:model-value="updateDraft(row.field, $event)"
								@input="trackBadInput(row.field, $event)"
								@keyup.enter="applyRow(row)"
							>
								<template #append>
									<span class="source" :class="{ pending: edited(row.field) }">
										{{ sourceLabel(sourceOf(row)) }}
									</span>
								</template>
							</v-input>
						</span>

						<v-button
							x-small
							icon
							secondary
							class="cancel"
							:tooltip="t('cache_settings_cancel', 'Discard this change')"
							:aria-label="t('cache_settings_cancel', 'Discard this change')"
							:disabled="saving || !edited(row.field)"
							@click="cancelRow(row.field)"
						>
							<v-icon name="close" x-small />
						</v-button>

						<v-button
							x-small
							icon
							class="apply"
							:tooltip="t('cache_settings_apply', 'Apply this change')"
							:aria-label="t('cache_settings_apply', 'Apply this change')"
							:disabled="saving || !edited(row.field)"
							@click="applyRow(row)"
						>
							<v-icon name="check" x-small />
						</v-button>

						<v-button
							x-small
							icon
							secondary
							class="reset"
							:tooltip="resetsTo(row)"
							:aria-label="resetsTo(row)"
							:disabled="saving || row.sharedSettings === null"
							@click="resetRow(row.field)"
						>
							<v-icon name="settings_backup_restore" x-small />
						</v-button>
					</td>
				</tr>
			</tbody>
		</table>

		<div class="bulk">
			<v-button small :disabled="!dirty || saving" @click="applyAll">
				{{ t('cache_settings_apply_all', 'Apply all changes') }}
			</v-button>

			<v-button small secondary :disabled="!dirty || saving" @click="resetAll">
				{{ t('cache_settings_reset_all', 'Reset all changes') }}
			</v-button>

			<v-button
				small
				secondary
				:disabled="!answer?.sharedSettings || saving"
				@click="resetToFallbacks"
			>
				{{ t('cache_settings_reset_fallbacks', 'Reset to the environment') }}
			</v-button>
		</div>

		<p v-if="answer" class="key">
			{{ t('cache_settings_key', 'Stored in') }} {{ answer.key }}
		</p>

		<p v-if="stampLine" class="stamp">{{ stampLine }}</p>
	</div>
</template>

<style scoped>
.cache-settings {
	margin-block-end: 32px;
}

.key,
.stamp {
	margin-block-end: 8px;
	color: var(--theme--foreground-subdued);
}

.fields {
	inline-size: 100%;
	border-collapse: collapse;
}

.fields th {
	text-align: start;
	color: var(--theme--foreground-subdued);
	font-weight: 600;
}

.fields td,
.fields th {
	padding: 4px 8px 4px 0;
}

.edit {
	display: flex;
	gap: 4px;
	align-items: center;
	max-inline-size: 440px;
}

.control {
	flex-grow: 1;
}

/* A number and the unit that names it read as one phrase at the start of the
   box, so the box grows with what is typed rather than stretching to the end. */
.control.numeric :deep(input) {
	flex-grow: 0;
	field-sizing: content;
	min-inline-size: 4ch;
	max-inline-size: 10ch;
}

.control :deep(.suffix) {
	margin-inline-start: 4px;
}

/* The layer that supplied the value, then a number's steppers, at the end of
   the box — the two points a select's chevron and layer read at. `.edit` earns
   the specificity `v-input` sets `.append`'s margin with. */
.edit .control.numeric :deep(.append) {
	order: 1;
	margin-inline-start: auto;
}

.control.numeric :deep(.arrows) {
	order: 2;
}

.control.choice :deep(.append) {
	display: flex;
	gap: 4px;
	align-items: center;
}

.control.choice :deep(.append > .v-icon) {
	order: 1;
}

.bulk {
	display: flex;
	flex-wrap: wrap;
	gap: 12px;
	align-items: center;
	margin-block: 12px 8px;
}

.source {
	flex-shrink: 0;
	color: var(--theme--foreground-subdued);
	font-size: 12px;
}

/* A change not written yet is the one thing on a row worth a colour. */
.control.pending :deep(input),
.source.pending {
	color: var(--theme--primary);
}
</style>
