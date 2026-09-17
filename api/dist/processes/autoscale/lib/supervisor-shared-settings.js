import { useEnv } from "@directus/env";
import { InvalidPayloadError } from "@directus/errors";
import { SUPERVISOR_BOUNDS } from "@directus/constants";

//#region src/processes/autoscale/lib/supervisor-shared-settings.ts
/** The pm2 entry each option is written to, which names the option itself. */
const ENTRIES = {
	listenTimeout: "listen_timeout",
	killTimeout: "kill_timeout",
	minUptime: "min_uptime",
	restartDelay: "restart_delay",
	maxRestarts: "max_restarts",
	maxMemoryRestartMegabytes: "max_memory_restart"
};
/**
* The same bounds the panel's inputs offer, read through an index signature so
* a field named by a request can be looked up by name.
*/
const BOUNDS = SUPERVISOR_BOUNDS;
/**
* What the shared settings carry besides the values themselves, kept out of
* what is handed to pm2 — the same stamp the configuration's shared settings
* take, and for the same reason: they outlive the incident that justified them.
*/
const NOTE_FIELDS = [
	"setBy",
	"setAt",
	"setFrom",
	"note"
];
const MEGABYTE = 1048576;
/** What pm2 falls back to, matching `ecosystem.config.cjs` entry for entry. */
const ENV_FALLBACKS = {
	listenTimeout: 15e3,
	killTimeout: 1600,
	minUptime: 1e3,
	restartDelay: 0,
	maxRestarts: 16,
	maxMemoryRestartMegabytes: null
};
const ENV_VARIABLES = {
	listenTimeout: "PM2_LISTEN_TIMEOUT",
	killTimeout: "PM2_KILL_TIMEOUT",
	minUptime: "PM2_MIN_UPTIME",
	restartDelay: "PM2_RESTART_DELAY",
	maxRestarts: "PM2_MAX_RESTARTS",
	maxMemoryRestartMegabytes: "PM2_MAX_MEMORY_RESTART"
};
/**
* The patch, checked field by field.
*
* Bounds are refused here rather than clamped: nothing downstream corrects
* these, so a value out of range would be handed to the supervisor as typed —
* a `kill_timeout` of zero drops every request a released worker was serving.
*/
function parseSupervisorPatch(patch) {
	const parsed = {};
	for (const [field, value] of Object.entries(patch)) {
		if (NOTE_FIELDS.includes(field)) {
			if (value !== null && typeof value !== "string") throw new InvalidPayloadError({ reason: `'${field}' has to be a string` });
			parsed[field] = value;
			continue;
		}
		const bounds = Object.hasOwn(BOUNDS, field) ? BOUNDS[field] : void 0;
		if (bounds === void 0) throw new InvalidPayloadError({ reason: `'${field}' is not an option a restart can carry` });
		if (value === null) {
			parsed[field] = null;
			continue;
		}
		if ((typeof value === "number" && Number.isInteger(value) && value >= bounds.low && value <= bounds.high) === false) throw new InvalidPayloadError({ reason: `'${field}' has to be a whole number between ${bounds.low} and ${bounds.high}` });
		parsed[field] = value;
	}
	return parsed;
}
/**
* The shared settings with the patch applied, a `null` value removing its field.
*
* Shared settings holding nothing but their own stamp are removed altogether,
* so a page reading them back does not show a supervisor as carrying some
* while every value it runs on came from the environment.
*/
function applySupervisorPatch(sharedSettings, patch) {
	const merged = { ...sharedSettings };
	for (const [field, value] of Object.entries(patch)) if (value === null) delete merged[field];
	else merged[field] = value;
	return Object.keys(merged).filter((field) => NOTE_FIELDS.includes(field) === false).length === 0 ? null : merged;
}
/** Megabytes in each suffix pm2 takes a size in. */
const SIZE_UNITS = {
	K: 1 / 1024,
	M: 1,
	G: 1024
};
/**
* A memory ceiling in megabytes, however pm2 was asked for it.
*
* pm2 takes this one as a size rather than as a number — `512M` as readily as
* the bytes a bare number means — while the panel asks for megabytes, so the
* two have to meet somewhere.
*/
function megabytesOf(declared) {
	const size = /^(\d+(?:\.\d+)?)\s*([KMG])?B?$/i.exec(String(declared).trim());
	if (size === null) return null;
	const unit = size[2]?.toUpperCase();
	const megabytes = unit === void 0 ? Number(size[1]) / MEGABYTE : Number(size[1]) * SIZE_UNITS[unit];
	return megabytes < 1 ? null : Math.round(megabytes);
}
/**
* What the environment asks for, which is what a released field goes back to.
*
* Read here rather than off the running pool: a restart that pushed a value
* has already replaced what the supervisor reports, so the pool can no longer
* say what it was started with.
*/
function fromEnv(field) {
	const declared = useEnv()[ENV_VARIABLES[field]];
	if (declared === void 0) return ENV_FALLBACKS[field] ?? null;
	const parsed = field === "maxMemoryRestartMegabytes" ? megabytesOf(declared) : Number(declared);
	return parsed === null || Number.isFinite(parsed) === false ? ENV_FALLBACKS[field] ?? null : parsed;
}
/**
* Every option a restart carries, as pm2 names them.
*
* The full set every time, not only what the shared settings hold: pm2 keeps
* the extended declaration on the running process, so a field released from
* the shared settings goes back to the environment's value only if the restart
* says so.
*/
function reloadDeclaration(sharedSettings) {
	const declaration = {};
	for (const [field, entry] of Object.entries(ENTRIES)) {
		const sharedSettingsValue = sharedSettings?.[field];
		const value = typeof sharedSettingsValue === "number" ? sharedSettingsValue : fromEnv(field);
		if (value === null) continue;
		declaration[entry] = field === "maxMemoryRestartMegabytes" ? value * MEGABYTE : value;
	}
	return declaration;
}

//#endregion
export { applySupervisorPatch, parseSupervisorPatch, reloadDeclaration };