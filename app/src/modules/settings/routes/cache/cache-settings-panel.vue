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

const settingsAnswer = ref<CacheSettingsAnswer | null>(null);
const panelError = ref<string | null>(null);
const isSaving = ref(false);
const pendingDrafts = ref<Record<string, string | null>>({});

// A number field holding what the browser cannot read reports it as emptied,
// which would write a reset, so the fields in that state are kept apart, with
// the box that holds it.
const badInputFields = ref(new Map<string, HTMLInputElement>());

// Bumped to give a field a new box: one whose value is null renders '' before
// and after its unreadableRows text is discarded, so only a new box drops it.
const inputGenerations = ref<Record<string, number>>({});

const settingRows = computed(() => cacheSettingRows(settingsAnswer.value));

/**
 * The  as one sentence, worded as the autoscale panel words its own, and
 * assembled here rather than out of template fragments, which drop the spaces
 * between them the moment one of the fragments is conditional.
 */
const stampLine = computed(() => {
	const settingsStamp = cacheSettingsStamp(settingsAnswer.value, Date.now());

	if (settingsStamp === null) {
		return null;
	}

	const stampWords = [t('cache_settings_set_by', 'Configured')];

	if (settingsStamp.setBy !== null) {
		stampWords.push(t('cache_settings_by', { writer: settingsStamp.setBy }));
	}

	if (settingsStamp.setFrom === 'admin') {
		stampWords.push(t('cache_settings_from_admin'));
	}

	if (settingsStamp.setFrom === 'mcp') {
		stampWords.push(t('cache_settings_from_mcp'));
	}

	stampWords.push(t('cache_settings_days_ago', { days: settingsStamp.days }));

	return stampWords.join(' ');
});

const hasDrafts = computed(() => Object.keys(pendingDrafts.value).length > 0);

onMounted(loadSettings);

watch(() => props.refreshKey, loadSettings);

/**
 * Bumped by every read and write, so a read answering after a later one, a
 * write included, leaves what that one showed.
 */
let latestRequest = 0;

async function loadSettings(): Promise<void> {
	latestRequest += 1;
	const thisRequest = latestRequest;

	try {
		const settingsResponse = await api.get('/utils/cache/settings');

		if (thisRequest !== latestRequest) {
			return;
		}

		settingsAnswer.value = settingsResponse.data.data;
		panelError.value = null;
	}
	catch (requestError: any) {
		if (thisRequest !== latestRequest) {
			return;
		}

		panelError.value = requestError?.response?.data?.errors?.[0]?.message
			?? String(requestError);
	}
}

/** Whether the write landed, so a refused one leaves the typing to fix. */
async function writeSettings(
	sendRequest: () => Promise<{ data: { data: CacheSettingsAnswer } }>,
): Promise<boolean> {
	latestRequest += 1;
	isSaving.value = true;
	panelError.value = null;

	try {
		const settingsResponse = await sendRequest();

		// A read sent while the write was in flight may have found the row before
		// the write committed.
		latestRequest += 1;
		settingsAnswer.value = settingsResponse.data.data;

		// Switching the cache on can clear it, which the page's figures show.
		emit('changed');
		return true;
	}
	catch (requestError: any) {
		panelError.value = requestError?.response?.data?.errors?.[0]?.message
			?? String(requestError);

		return false;
	}
	finally {
		isSaving.value = false;
	}
}

function writePatch(settingsPatch: Record<string, unknown>): Promise<boolean> {
	return writeSettings(() => api.patch('/utils/cache/settings', settingsPatch));
}

function isEdited(field: string): boolean {
	return field in pendingDrafts.value;
}

/**
 * Which layer the value in the box would come from: a field being typed into
 * lands in the settings, and one emptied names no layer until it lands.
 */
function sourceOf(row: CacheSettingRow): CacheSettingSource | null {
	if (isEdited(row.field) === false) {
		return row.source;
	}

	const draftValue = pendingDrafts.value[row.field];

	return draftValue === null || draftValue === ''
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
function shownValue(row: CacheSettingRow): string | null {
	if (isEdited(row.field)) {
		return pendingDrafts.value[row.field] ?? null;
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
 * event, so the box is asked again whether it still holds unreadableRows text.
 */
function updateDraft(field: string, value: string | null): void {
	pendingDrafts.value[field] = value;

	if (badInputFields.value.get(field)?.validity.badInput === false) {
		badInputFields.value.delete(field);
	}
}

function inputKey(field: string): string {
	return `${field}:${inputGenerations.value[field] ?? 0}`;
}

/** Refuse the write while one of `checkedRows` holds unreadable text. */
function refusesBadInput(checkedRows: CacheSettingRow[]): boolean {
	const unreadableRows = checkedRows.filter(
		(row) => badInputFields.value.has(row.field),
	);

	if (unreadableRows.length === 0) {
		return false;
	}

	panelError.value = `${t('not_a_number')}: ${
		unreadableRows.map((row) => row.variable).join(', ')
	}`;

	return true;
}

function forgetDraft(field: string): void {
	delete pendingDrafts.value[field];

	if (badInputFields.value.delete(field)) {
		inputGenerations.value[field] = (inputGenerations.value[field] ?? 0) + 1;
	}
}

async function applyRow(row: CacheSettingRow): Promise<void> {
	if (isEdited(row.field) === false || refusesBadInput([row])) {
		return;
	}

	const value = parseCacheSettingValue(row.kind, pendingDrafts.value[row.field]);

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
	const settingsPatch: Record<string, unknown> = {};

	if (refusesBadInput(settingRows.value.filter((row) => isEdited(row.field)))) {
		return;
	}

	for (const row of settingRows.value) {
		if (isEdited(row.field)) {
			settingsPatch[row.field] = parseCacheSettingValue(
				row.kind,
				pendingDrafts.value[row.field],
			);
		}
	}

	if (await writePatch(settingsPatch) === false) {
		return;
	}

	for (const field of Object.keys(settingsPatch)) {
		forgetDraft(field);
	}
}

function resetAll(): void {
	for (const field of Object.keys(pendingDrafts.value)) {
		forgetDraft(field);
	}
}

async function resetToFallbacks(): Promise<void> {
	if (await writeSettings(() => api.delete('/utils/cache/settings'))) {
		resetAll();
	}
}

/** What resetting a field would leave it on, named in the button that does it. */
function resetsTo(row: CacheSettingRow): string {
	const resetLabel = t('cache_settings_reset_env', 'Reset to the environment:');

	return row.fallback === null
		? `${resetLabel} —`
		: `${resetLabel} ${String(row.fallback)}`;
}
</script>

<template>
	<div class="cache-settings">
		<v-notice v-if="panelError" type="danger">{{ panelError }}</v-notice>

		<table class="fields">
			<thead>
				<tr>
					<th>{{ t('cache_settings_field', 'Field') }}</th>
					<th>{{ t('cache_settings_value', 'Value') }}</th>
				</tr>
			</thead>
			<tbody>
				<tr
					v-for="row in settingRows"
					:key="row.field"
					:data-variable="row.variable"
				>
					<td>
						<span v-tooltip="row.description">{{ row.variable }}</span>
					</td>
					<td class="edit">
						<!-- `v-select`'s own root has no layout box, so the cell's flex
						row lays this span out instead. -->
						<span
							v-if="row.options"
							role="group"
							:aria-label="row.variable"
							class="control choice"
							:class="{ pending: isEdited(row.field) }"
						>
							<v-select
								:model-value="shownValue(row)"
								:items="row.options"
								small
								:disabled="isSaving"
								@update:model-value="updateDraft(row.field, $event)"
							>
								<template #append>
									<span class="source" :class="{ pending: isEdited(row.field) }">
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
								pending: isEdited(row.field),
							}"
						>
							<v-input
								:key="inputKey(row.field)"
								:model-value="shownValue(row) ?? ''"
								small
								full-width
								:type="row.kind === 'number' ? 'number' : 'text'"
								:min="row.min"
								:step="row.step"
								:suffix="row.unit"
								:disabled="isSaving"
								:aria-label="row.variable"
								@update:model-value="updateDraft(row.field, $event)"
								@input="trackBadInput(row.field, $event)"
								@keyup.enter="applyRow(row)"
							>
								<template #append>
									<span class="source" :class="{ pending: isEdited(row.field) }">
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
							:disabled="isSaving || !isEdited(row.field)"
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
							:disabled="isSaving || !isEdited(row.field)"
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
							:disabled="isSaving || row.sharedSettings === null"
							@click="resetRow(row.field)"
						>
							<v-icon name="settings_backup_restore" x-small />
						</v-button>
					</td>
				</tr>
			</tbody>
		</table>

		<div class="bulk">
			<v-button small :disabled="!hasDrafts || isSaving" @click="applyAll">
				{{ t('cache_settings_apply_all', 'Apply all changes') }}
			</v-button>

			<v-button small secondary :disabled="!hasDrafts || isSaving" @click="resetAll">
				{{ t('cache_settings_reset_all', 'Reset all changes') }}
			</v-button>

			<v-button
				small
				secondary
				:disabled="!settingsAnswer?.sharedSettings || isSaving"
				@click="resetToFallbacks"
			>
				{{ t('cache_settings_reset_fallbacks', 'Reset to the environment') }}
			</v-button>
		</div>

		<p v-if="settingsAnswer" class="key">
			{{ t('cache_settings_key', 'Stored in') }} {{ settingsAnswer.key }}
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
