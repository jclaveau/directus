import { InvalidPayloadError } from "@directus/errors";

//#region src/processes/autoscale/lib/shared-settings.ts
const FIELD_TYPES = {
	enabled: "boolean",
	strategy: ["scalabus", "legacy"],
	appName: "string",
	signal: ["average", "max"],
	sampleWindow: "number",
	scaleCpuThreshold: "number",
	releaseCpuThreshold: "number",
	minWorkers: "number",
	maxWorkers: "number",
	prewarmWorkers: "number",
	minSecondsToScaleUp: "number",
	minSecondsToScaleDown: "number",
	warmupSeconds: "number"
};
/**
* What the shared settings carry besides the configuration itself.
*
* The loop takes only the fields it knows, so these ride in the same object
* without reaching it. They are what turns a forgotten `{"enabled": false}`
* into one an operator can date and attribute — to a person, and to the
* surface they used — which is the failure this feature invites and the log
* line it would otherwise take to answer.
*/
const NOTE_FIELDS = [
	"setBy",
	"setAt",
	"setFrom",
	"note"
];
/**
* The patch, checked field by field.
*
* A value the loop would silently drop has to fail here instead: an operator
* who typed a ceiling and watched the pool ignore it has no way to tell a
* rejected write from a clamped one. One field against another — a floor
* against its ceiling — is not checked here: the ceiling is usually a field
* this patch never mentions, so the whole resolved configuration is judged
* once the patch has been laid over it.
*/
function parseSharedSettingsPatch(patch) {
	const parsed = {};
	for (const [field, value] of Object.entries(patch)) {
		if (NOTE_FIELDS.includes(field)) {
			if (value !== null && typeof value !== "string") throw new InvalidPayloadError({ reason: `'${field}' has to be a string` });
			parsed[field] = value;
			continue;
		}
		const expected = Object.hasOwn(FIELD_TYPES, field) ? FIELD_TYPES[field] : void 0;
		if (expected === void 0) throw new InvalidPayloadError({ reason: `'${field}' is not a field of the autoscale configuration` });
		if (value === null) {
			parsed[field] = null;
			continue;
		}
		if (Array.isArray(expected)) {
			if (expected.includes(value) === false) throw new InvalidPayloadError({ reason: `'${field}' has to be one of ${expected.join(", ")}` });
		} else if (expected === "number") {
			if ((typeof value === "number" && Number.isFinite(value) && value >= 0) === false) throw new InvalidPayloadError({ reason: `'${field}' has to be a number of zero or more` });
		} else if (typeof value !== expected) throw new InvalidPayloadError({ reason: `'${field}' has to be a ${expected}` });
		parsed[field] = value;
	}
	return parsed;
}
/**
* The shared settings with the patch applied, a `null` value removing its field.
*
* Shared settings that end up holding nothing but their own note are removed
* altogether: a page reading them would otherwise show a deployment as
* carrying some while every value it runs on comes from its environment.
*/
function applySharedSettingsPatch(sharedSettings, patch) {
	const merged = { ...sharedSettings };
	for (const [field, value] of Object.entries(patch)) if (value === null) delete merged[field];
	else merged[field] = value;
	return Object.keys(merged).filter((field) => NOTE_FIELDS.includes(field) === false).length === 0 ? null : merged;
}

//#endregion
export { applySharedSettingsPatch, parseSharedSettingsPatch };