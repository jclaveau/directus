import { parseSharedSettingsPatch } from "../autoscale/lib/shared-settings.js";
import { SHARED_SETTINGS_COLUMNS, asSharedSettings } from "./shared-settings.js";
import { parseSupervisorPatch } from "../autoscale/lib/supervisor-shared-settings.js";
import { configWithSharedSettings } from "../autoscale/lib/resolve-config.js";
import { assertUsableConfig } from "../autoscale/lib/validate-config.js";
import { InvalidPayloadError } from "@directus/errors";

//#region src/processes/lib/settings-guard.ts
/**
* The column's document, or nothing where the write does not carry one.
*
* `null` is a value here and not an absence — it is how a whole layer is handed
* back to the environment — so it is told apart from the column going
* unmentioned, which a patch of one other field does.
*/
function documentIn(payload, column) {
	const value = payload[column];
	if (value === null || value === void 0) return null;
	const document = asSharedSettings(value);
	if (document === null) throw new InvalidPayloadError({ reason: `'${column}' has to be an object of settings, or null to hand the whole layer back to the environment` });
	return document;
}
/**
* Refuse a settings write that would store a layer the pool cannot run.
*
* The same checks `/utils/autoscale` makes, applied to the column instead of to
* the route: the columns are ordinary fields of the settings singleton, so
* `PATCH /settings` reaches them, and so does a config-sync import or a seed
* script writing through a plain `ItemsService`. Guarding the route left every
* one of those able to store a floor above its ceiling and announce it to the
* fleet, which is the correction-versus-refusal the checks exist to avoid.
*/
function assertUsableSharedSettings(payload) {
	if (SHARED_SETTINGS_COLUMNS.autoscale in payload) {
		const autoscale = documentIn(payload, SHARED_SETTINGS_COLUMNS.autoscale);
		if (autoscale !== null) {
			parseSharedSettingsPatch(autoscale);
			assertUsableConfig(configWithSharedSettings(autoscale));
		}
	}
	if (SHARED_SETTINGS_COLUMNS.supervisor in payload) {
		const supervisor = documentIn(payload, SHARED_SETTINGS_COLUMNS.supervisor);
		if (supervisor !== null) parseSupervisorPatch(supervisor);
	}
}
/**
* Check every write to the singleton, whatever made it.
*
* On the filter rather than the action for the reason `SettingsService` gives
* for `cache_ttl`: a check has to run before the write, and an action runs
* after one. On the emitter rather than in that service because the service is
* only one of the ways the singleton is written.
*/
async function initSharedSettingsGuard() {
	const { default: emitter } = await import("../../emitter.js");
	for (const event of ["settings.create", "settings.update"]) emitter.onFilter(event, (payload) => {
		assertUsableSharedSettings(payload);
		return payload;
	});
}

//#endregion
export { assertUsableSharedSettings, initSharedSettingsGuard };