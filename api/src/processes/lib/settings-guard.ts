import { InvalidPayloadError } from '@directus/errors';
import type { Item } from '@directus/types';
import {
	assertUsableCacheSettings,
	type SettingsWriteEntry,
} from '../../cache-settings.js';
import { parseSharedSettingsPatch } from '../autoscale/lib/shared-settings.js';
import { configWithSharedSettings } from '../autoscale/lib/resolve-config.js';
import {
	parseSupervisorPatch,
} from '../autoscale/lib/supervisor-shared-settings.js';
import { assertUsableConfig } from '../autoscale/lib/validate-config.js';
import { isPositiveDuration } from '../../utils/get-milliseconds.js';
import { validateCron } from '../../utils/validate-cron.js';
import {
	SHARED_SETTINGS_COLUMNS,
	asSharedSettings,
	type SharedSettings,
	type SharedSettingsColumn,
} from './shared-settings.js';

/**
 * The column's document, or nothing where the write does not carry one.
 *
 * `null` is a value here and not an absence — it is how a whole layer is handed
 * back to the environment — so it is told apart from the column going
 * unmentioned, which a patch of one other field does.
 */
function documentIn(
	payload: Partial<Item>,
	column: SharedSettingsColumn,
): SharedSettings | null {
	const value = payload[column];

	if (value === null || value === undefined) {
		return null;
	}

	const document = asSharedSettings(value);

	// Read the way the loop reads it, so what is refused here is exactly what
	// would have been unreadable there: anything else is stored, read back as
	// nothing, and runs the environment while the column says otherwise.
	if (document === null) {
		throw new InvalidPayloadError({
			reason: `'${column}' has to be an object of settings, `
				+ 'or null to hand the whole layer back to the environment',
		});
	}

	return document;
}

/**
 * Refuse a settings write that would store a layer nothing can run.
 *
 * The same checks `/utils/autoscale` makes, applied to the column instead of to
 * the route: the columns are ordinary fields of the settings singleton, so
 * `PATCH /settings` reaches them, and so does a config-sync import or a seed
 * script writing through a plain `ItemsService`. Guarding the route left every
 * one of those able to store a floor above its ceiling and announce it to the
 * fleet, which is the correction-versus-refusal the checks exist to avoid.
 */
export function assertUsableSharedSettings(payload: Partial<Item>): void {
	if (SHARED_SETTINGS_COLUMNS.autoscale in payload) {
		const autoscale = documentIn(payload, SHARED_SETTINGS_COLUMNS.autoscale);

		if (autoscale !== null) {
			parseSharedSettingsPatch(autoscale);

			// Judged whole rather than field by field, for the reason the route
			// gives: a floor is only too high against the ceiling it will sit
			// under, and that ceiling can be a field the environment holds.
			assertUsableConfig(configWithSharedSettings(autoscale));
		}
	}

	if (SHARED_SETTINGS_COLUMNS.supervisor in payload) {
		const supervisor = documentIn(payload, SHARED_SETTINGS_COLUMNS.supervisor);

		if (supervisor !== null) {
			parseSupervisorPatch(supervisor);
		}
	}

	if (SHARED_SETTINGS_COLUMNS.cache in payload) {
		const cacheLayer = documentIn(payload, SHARED_SETTINGS_COLUMNS.cache);

		if (cacheLayer !== null) {
			assertUsableCacheSettings(cacheLayer);
		}
	}
}

/**
 * Refuse a `cache_ttl` or a `cache_audit_schedule` nothing can run. An empty
 * value is one: it hands the field back to the environment.
 *
 * A TTL ms cannot read as a positive duration would be stored, then fall back
 * on the hot path and leave the `__expires_at` sidecar out of step with the
 * entry's real lifetime. A rule node-schedule cannot read would be stored, then
 * every node would drop its audit job and schedule nothing.
 */
export function assertUsableCacheFields(payload: Partial<Item>): void {
	const ttl = payload['cache_ttl'];

	if (typeof ttl === 'string' && ttl.trim() !== '' && !isPositiveDuration(ttl)) {
		throw new InvalidPayloadError({
			reason: `Invalid cache_ttl "${ttl}" — expected a positive `
				+ `duration like "30s", "5m", "1h"`,
		});
	}

	const rule = payload['cache_audit_schedule'];

	if (typeof rule === 'string' && rule.trim() !== '' && !validateCron(rule.trim())) {
		throw new InvalidPayloadError({
			reason: `Invalid cache_audit_schedule "${rule}" — expected a cron `
				+ 'rule like "0 3 * * *"',
		});
	}
}

/**
 * Check every write to the singleton, whatever made it.
 *
 * On the filter rather than the action: a check has to run before the write,
 * and an action runs after one. On the emitter rather than in `SettingsService`
 * because the service is only one of the ways the singleton is written.
 */
export async function initSharedSettingsGuard(): Promise<void> {
	const { default: emitter } = await import('../../emitter.js');

	// The create as well as the update: a deployment nobody has saved a setting
	// on yet has no singleton row, and the first write to it makes one. Last, so
	// it checks what a flow filter, registered again on every reload, left.
	for (const event of ['settings.create', 'settings.update']) {
		emitter.onFilter<SettingsWriteEntry[] | null>(event, (payload) => {
			if (payload === null) {
				return payload;
			}

			for (const entry of payload) {
				if (entry !== null && 'data' in entry) {
					assertUsableSharedSettings(entry.data);
					assertUsableCacheFields(entry.data);
				}
			}

			return payload;
		}, { runsLast: true });
	}
}
