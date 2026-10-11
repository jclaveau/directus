import { useLogger } from "../../../logger/index.js";
import { SHARED_SETTINGS_COLUMNS, onSharedSettingsChanged, readSharedSettings, sharedSettingsPollMs } from "../../lib/shared-settings.js";
import { AUTOSCALE_DEFAULTS, numberOr, sanitizeConfig, signalOr, strategyOr } from "./sanitize-config.js";
import { useEnv } from "@directus/env";

//#region src/processes/autoscale/lib/resolve-config.ts
/** The variable each field reads, so a page can say where a value came from. */
const ENV_KEYS = {
	enabled: "PM2_AUTOSCALE_ENABLED",
	strategy: "PM2_AUTOSCALE_STRATEGY",
	appName: "PM2_AUTOSCALE_APP_NAME",
	signal: "PM2_AUTOSCALE_SIGNAL",
	sampleWindow: "PM2_AUTOSCALE_SAMPLE_WINDOW",
	scaleCpuThreshold: "PM2_AUTOSCALE_SCALE_CPU_THRESHOLD",
	releaseCpuThreshold: "PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD",
	minWorkers: "PM2_AUTOSCALE_MIN_WORKERS",
	maxWorkers: "PM2_AUTOSCALE_MAX_WORKERS",
	prewarmWorkers: "PM2_AUTOSCALE_PREWARM",
	minSecondsToScaleUp: "PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER",
	minSecondsToScaleDown: "PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER",
	warmupSeconds: "PM2_AUTOSCALE_WARMUP_SECONDS"
};
/**
* Which layer each field's value came from.
*
* An operator reading a threshold needs to know whether changing the
* deployment's environment would move it, or whether the shared settings are
* holding it where it is — the two look identical in the resolved value.
*
* Told by what the merge took rather than by what the column mentions: the
* column is editable outside the write that checks it, and a value the merge
* could not use leaves its field on the environment. Naming that field as
* stored is a page disagreeing with the pool it describes.
*/
function sourcesOf(taken) {
	const env = useEnv();
	const sources = {};
	for (const field of Object.keys(ENV_KEYS)) {
		let source = "default";
		if (env[ENV_KEYS[field]] !== void 0) source = "env";
		if (taken.has(field)) source = "sharedSettings";
		sources[field] = source;
	}
	return sources;
}
/** The configuration this process's environment alone resolves. */
function envConfig() {
	const env = useEnv();
	return {
		enabled: env["PM2_AUTOSCALE_ENABLED"] !== false,
		strategy: strategyOr(env["PM2_AUTOSCALE_STRATEGY"], "scalabus"),
		appName: String(env["PM2_AUTOSCALE_APP_NAME"] ?? "api"),
		signal: signalOr(env["PM2_AUTOSCALE_SIGNAL"], "average"),
		sampleWindow: numberOr(env["PM2_AUTOSCALE_SAMPLE_WINDOW"], AUTOSCALE_DEFAULTS.sampleWindow),
		scaleCpuThreshold: numberOr(env["PM2_AUTOSCALE_SCALE_CPU_THRESHOLD"], AUTOSCALE_DEFAULTS.scaleCpuThreshold),
		releaseCpuThreshold: numberOr(env["PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD"], AUTOSCALE_DEFAULTS.releaseCpuThreshold),
		minWorkers: numberOr(env["PM2_AUTOSCALE_MIN_WORKERS"], AUTOSCALE_DEFAULTS.minWorkers),
		maxWorkers: numberOr(env["PM2_AUTOSCALE_MAX_WORKERS"], AUTOSCALE_DEFAULTS.maxWorkers),
		prewarmWorkers: numberOr(env["PM2_AUTOSCALE_PREWARM"], AUTOSCALE_DEFAULTS.prewarmWorkers),
		minSecondsToScaleUp: numberOr(env["PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER"], AUTOSCALE_DEFAULTS.minSecondsToScaleUp),
		minSecondsToScaleDown: numberOr(env["PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER"], AUTOSCALE_DEFAULTS.minSecondsToScaleDown),
		warmupSeconds: numberOr(env["PM2_AUTOSCALE_WARMUP_SECONDS"], AUTOSCALE_DEFAULTS.warmupSeconds)
	};
}
/**
* Only the fields the shared settings actually set are taken from them, so
* raising one threshold during an incident leaves the rest on the env chain
* rather than resetting them to defaults nobody asked for.
*
* A field whose stored value this cannot use is left on the chain too, left out
* of `taken` with it, and named in `refused` so the drop is not silent. Refused
* rather than thrown on: this runs on the scaling tick, and the value it is
* reading is already durable — a throw would end the pool on every tick until
* somebody edited the table. The write is where a bad value is refused, and
* the check the settings guard runs is what refuses it there.
*/
function withSharedSettings(base, sharedSettings$1) {
	const config = { ...base };
	const taken = /* @__PURE__ */ new Set();
	const refused = [];
	for (const [name, value] of Object.entries(sharedSettings$1)) {
		if (Object.hasOwn(base, name) === false) continue;
		if (value === null || value === void 0) continue;
		const field = name;
		const current = base[field];
		const stored = `${name}=${JSON.stringify(value)}`;
		if (typeof current === "number") {
			const parsed = Number(value);
			if (Number.isFinite(parsed) === false || parsed < 0) {
				refused.push(stored);
				continue;
			}
			Object.assign(config, { [field]: parsed });
		} else if (typeof current === "boolean") {
			if (value !== true && value !== false) {
				refused.push(stored);
				continue;
			}
			Object.assign(config, { [field]: value });
		} else if (field === "signal") {
			if (signalOr(value, base.signal) !== value) {
				refused.push(stored);
				continue;
			}
			Object.assign(config, { [field]: value });
		} else if (field === "strategy") {
			if (strategyOr(value, base.strategy) !== value) {
				refused.push(stored);
				continue;
			}
			Object.assign(config, { [field]: value });
		} else if (typeof current === "string" && typeof value === "string") Object.assign(config, { [field]: value });
		else {
			refused.push(stored);
			continue;
		}
		taken.add(field);
	}
	return {
		config,
		taken,
		refused
	};
}
/**
* What the loop would run on with these shared settings laid over the
* environment.
*
* The env chain read here is this process's rather than the scaling process's,
* which is a different process with the same deployment's environment. It is
* what a write has to be judged against: the field being changed is compared
* with fields nobody is changing, and those come from the chain.
*
* Laid over the chain as the chain is, and not settled. Settling first resolves
* a floor against the ceiling the environment declared, and the write being
* judged is usually the one raising that ceiling — judged against the settled
* floor, it is judged against a pool no tick will run. Settling after would
* hide the opposite case just as well: what settling does to a floor above its
* ceiling is clamp it, and a write nobody refuses is a write that gets stored,
* announced to the fleet and quietly corrected on the next tick.
*/
function configWithSharedSettings(sharedSettings$1) {
	return withSharedSettings(envConfig(), sharedSettings$1).config;
}
/**
* How long the first read may take before the loop starts without it.
*
* A tick on the environment chain scales the pool on the wrong floor for a
* moment; a loop that has not started scales it not at all, and a database
* that is simply unreachable holds a query for as long as its own acquire
* timeout allows. The mirror takes the read whenever it lands.
*/
const BOOT_READ_MS = 5e3;
let lastCorrections = "";
let lastRefused = "";
let lastAnnounced = null;
let lastBase = null;
let lastSources = null;
let sharedSettings = null;
let readAt = 0;
let reading = false;
let unreadable = false;
/**
* Where each field of the configuration the last tick used came from.
*
* Held beside the configuration rather than returned with it because it
* answers a different question — one the loop never asks and a page always
* does.
*/
function resolvedSources() {
	return lastSources ?? sourcesOf(/* @__PURE__ */ new Set());
}
/**
* What the last tick would have run on with nothing stored.
*
* The page offers to clear a field, and the value that lands there is this
* one — knowable only here, since the shared settings win over it everywhere
* else.
*/
function resolvedWithoutSharedSettings() {
	return lastBase ?? sanitizeConfig(envConfig()).config;
}
function announce(corrections) {
	const summary = corrections.join(", ");
	if (summary === lastCorrections) return;
	lastCorrections = summary;
	if (summary !== "") useLogger().warn(`[autoscale] configuration corrected: ${summary}`);
}
/**
* Say which stored values the merge could not use.
*
* The pool is running the environment's value for those fields and the page
* says so, which leaves the operator who stored one with a page that agrees
* with the pool and neither of them mentioning what they did with what was
* asked for. Every write through the API is checked, so a field reaching here
* was stored by something that went around it.
*/
function announceRefused(refused) {
	const summary = refused.join(", ");
	if (summary === lastRefused) return;
	lastRefused = summary;
	if (summary !== "") useLogger().warn(`[autoscale] unusable shared settings, left on the environment: ${summary}`);
}
/**
* Say what the pool is being tuned by, at boot and whenever that changes.
*
* Nothing stored gets a line of its own rather than silence: a layer that went
* missing — a column cleared, a database restored from before it was written —
* reads exactly like a deployment that never had one, and the difference
* between them is a ceiling somebody raised to survive an incident.
*/
function announceSharedSettings() {
	const summary = sharedSettings === null ? "nothing stored, so the environment chain alone" : Object.keys(sharedSettings).join(", ");
	if (summary === lastAnnounced) return;
	lastAnnounced = summary;
	useLogger().info(`[autoscale] shared settings: ${summary}`);
}
/**
* Re-read the stored layer into the mirror.
*
* Best-effort, and the last one read is kept on a failure rather than the
* environment being taken back: an operator who has just raised the ceiling to
* survive a spike would have it dropped by a blip, and the ceiling is
* corrected with no cooldown — the pool would lose the workers at once and
* take them back when the database answered again.
*/
async function refreshSharedSettings() {
	if (reading) return;
	reading = true;
	try {
		sharedSettings = await readSharedSettings(SHARED_SETTINGS_COLUMNS.autoscale);
		unreadable = false;
		announceSharedSettings();
	} catch (error) {
		if (unreadable === false) {
			unreadable = true;
			useLogger().warn(error, "[autoscale] could not read the shared settings; holding the last ones read");
		}
	} finally {
		readAt = Date.now();
		reading = false;
	}
}
/**
* Seed the mirror and keep it current.
*
* Awaited at boot so the first tick decides on what is stored rather than on
* the environment it would fall back to — a pool that starts at the
* environment's floor and climbs to a stored one has spent that climb short of
* workers — but only for as long as {@link BOOT_READ_MS} allows.
*/
async function initSharedSettingsMirror() {
	const read = refreshSharedSettings();
	if (await Promise.race([read.then(() => true), new Promise((resolve) => {
		setTimeout(() => resolve(false), BOOT_READ_MS).unref();
	})]) === false) useLogger().warn("[autoscale] the shared settings have not answered yet; scaling on the environment chain until they do");
	onSharedSettingsChanged(SHARED_SETTINGS_COLUMNS.autoscale, () => {
		refreshSharedSettings();
	});
}
/**
* The configuration for this tick: the env chain with the stored layer over
* it, checked before the loop is allowed to act on it.
*
* Tuning an autoscaler by redeploying restarts the pool, which destroys the
* state being tuned, so the values have to be changeable without one.
*
* Read off the mirror rather than the table: a tick is the only thing standing
* between a pool and the size an outage caught it at, and a query on its path
* is a query that can hold it for as long as the outage lasts.
*/
function resolveConfig() {
	if (Date.now() - readAt >= sharedSettingsPollMs()) refreshSharedSettings();
	const fromEnv = envConfig();
	const layered = withSharedSettings(fromEnv, sharedSettings ?? {});
	const { config, corrections } = sanitizeConfig(layered.config);
	announce(corrections);
	announceRefused(layered.refused);
	lastBase = sanitizeConfig(fromEnv).config;
	lastSources = sourcesOf(layered.taken);
	return config;
}

//#endregion
export { configWithSharedSettings, envConfig, initSharedSettingsMirror, resolveConfig, resolvedSources, resolvedWithoutSharedSettings };