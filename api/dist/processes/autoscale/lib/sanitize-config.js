import { AUTOSCALE_BOUNDS } from "@directus/constants";

//#region src/processes/autoscale/lib/sanitize-config.ts
/** What every numeric field falls back to, wherever one turns out unusable. */
const AUTOSCALE_DEFAULTS = {
	sampleWindow: 5,
	scaleCpuThreshold: 70,
	releaseCpuThreshold: 40,
	minWorkers: 1,
	maxWorkers: 4,
	prewarmWorkers: 0,
	minSecondsToScaleUp: 10,
	minSecondsToScaleDown: 300,
	warmupSeconds: 30
};
const SIGNALS = ["average", "max"];
const STRATEGIES = ["scalabus", "legacy"];
/** A finite, non-negative number, or the fallback for anything else. */
function numberOr(value, fallback) {
	const parsed = Number(value);
	return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
function signalOr(value, fallback) {
	return SIGNALS.includes(value) ? value : fallback;
}
function strategyOr(value, fallback) {
	return STRATEGIES.includes(value) ? value : fallback;
}
/**
* `value` inside `[low, high]`, or the field's default when it is not a
* number at all — NaN clamps to NaN, and a NaN threshold satisfies neither
* comparison, which stops the pool scaling in either direction while logging
* nothing about why.
*/
function clamp(value, low, high, fallback) {
	const usable = Number.isFinite(value) ? value : fallback;
	return Math.min(Math.max(Math.round(usable), low), high);
}
/**
* A configuration the loop can act on without checking it again.
*
* Every field here is settable at runtime by anyone who can write one Redis
* key, which is the point of the feature and also its sharpest edge: the
* values are edited during an incident, by hand, under pressure. A pair of
* bounds the wrong way round makes the pool grow and shrink on alternate
* ticks forever, and a `minWorkers` with one digit too many asks pm2 for more
* workers than the box can hold — which is the failure this whole autoscaler
* exists to stop, arriving through its own configuration.
*
* Returns what it changed so the caller can say so once rather than once a
* second.
*/
function sanitizeConfig(config) {
	const corrections = [];
	const sane = { ...config };
	const settle = (field, high = AUTOSCALE_BOUNDS[field].high, low = AUTOSCALE_BOUNDS[field].low) => {
		const value = clamp(config[field], low, high, AUTOSCALE_DEFAULTS[field]);
		if (value !== config[field]) {
			corrections.push(`${field} ${String(config[field])} -> ${value}`);
			sane[field] = value;
		}
		return value;
	};
	const maxWorkers = settle("maxWorkers");
	settle("minWorkers", maxWorkers);
	settle("prewarmWorkers", maxWorkers);
	settle("sampleWindow");
	settle("releaseCpuThreshold", settle("scaleCpuThreshold") - 1);
	settle("minSecondsToScaleUp");
	settle("minSecondsToScaleDown");
	settle("warmupSeconds");
	sane.signal = signalOr(config.signal, "average");
	if (sane.signal !== config.signal) corrections.push(`signal ${String(config.signal)} -> ${sane.signal}`);
	sane.strategy = strategyOr(config.strategy, "scalabus");
	if (sane.strategy !== config.strategy) corrections.push(`strategy ${String(config.strategy)} -> ${sane.strategy}`);
	return {
		config: sane,
		corrections
	};
}

//#endregion
export { AUTOSCALE_DEFAULTS, numberOr, sanitizeConfig, signalOr, strategyOr };