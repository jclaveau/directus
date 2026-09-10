import { AUTOSCALE_BOUNDS } from '@directus/constants';
import type {
	AutoscaleConfig,
	AutoscaleSignal,
	AutoscaleStrategy,
} from '../types.js';

/** What every numeric field falls back to, wherever one turns out unusable. */
export const AUTOSCALE_DEFAULTS = {
	sampleWindow: 5,
	scaleCpuThreshold: 70,
	releaseCpuThreshold: 40,
	minWorkers: 1,
	maxWorkers: 4,
	prewarmWorkers: 0,
	minSecondsToScaleUp: 10,
	minSecondsToScaleDown: 300,
	warmupSeconds: 30,
} as const;

const SIGNALS: AutoscaleSignal[] = ['average', 'max'];

const STRATEGIES: AutoscaleStrategy[] = ['scalabus', 'legacy'];

/** A finite, non-negative number, or the fallback for anything else. */
export function numberOr(value: unknown, fallback: number): number {
	const parsed = Number(value);

	return Number.isFinite(parsed) && parsed >= 0
		? parsed
		: fallback;
}

export function signalOr(
	value: unknown,
	fallback: AutoscaleSignal,
): AutoscaleSignal {
	return SIGNALS.includes(value as AutoscaleSignal)
		? value as AutoscaleSignal
		: fallback;
}

export function strategyOr(
	value: unknown,
	fallback: AutoscaleStrategy,
): AutoscaleStrategy {
	return STRATEGIES.includes(value as AutoscaleStrategy)
		? value as AutoscaleStrategy
		: fallback;
}

/**
 * `value` inside `[low, high]`, or the field's default when it is not a
 * number at all — NaN clamps to NaN, and a NaN threshold satisfies neither
 * comparison, which stops the pool scaling in either direction while logging
 * nothing about why.
 */
function clamp(
	value: number,
	low: number,
	high: number,
	fallback: number,
): number {
	const usable = Number.isFinite(value)
		? value
		: fallback;

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
export function sanitizeConfig(config: AutoscaleConfig): {
	config: AutoscaleConfig;
	corrections: string[];
} {
	const corrections: string[] = [];
	const sane = { ...config };

	// The bounds default to the shared table and are passed only where one of
	// them depends on another field's settled value.
	const settle = <Field extends keyof typeof AUTOSCALE_BOUNDS>(
		field: Field,
		high: number = AUTOSCALE_BOUNDS[field].high,
		low: number = AUTOSCALE_BOUNDS[field].low,
	) => {
		const value = clamp(config[field], low, high, AUTOSCALE_DEFAULTS[field]);

		if (value !== config[field]) {
			corrections.push(`${field} ${String(config[field])} -> ${value}`);
			sane[field] = value;
		}

		return value;
	};

	// The ceiling wins over the floor: it stands for what the box holds, and a
	// floor above it asks for workers there is no room for. Left alone the two
	// correct each other on alternate ticks, and neither waits for a cooldown.
	const maxWorkers = settle('maxWorkers');
	settle('minWorkers', maxWorkers);
	settle('prewarmWorkers', maxWorkers);

	settle('sampleWindow');

	// A release threshold at or above the scale threshold gives the pool a
	// reading that is both too hot to grow and too cold to hold: at the
	// ceiling the add branch is skipped for want of room, the release branch
	// fires on the same reading, and the worker comes straight back.
	const scaleCpuThreshold = settle('scaleCpuThreshold');
	settle('releaseCpuThreshold', scaleCpuThreshold - 1);

	settle('minSecondsToScaleUp');
	settle('minSecondsToScaleDown');
	settle('warmupSeconds');

	sane.signal = signalOr(config.signal, 'average');

	if (sane.signal !== config.signal) {
		corrections.push(`signal ${String(config.signal)} -> ${sane.signal}`);
	}

	// A misspelled strategy falls back to this autoscaler's own rule rather
	// than to the module's: the operator reaching for `legacy` is reverting an
	// incident, and a typo silently leaving them on a rule they believe they
	// have left is worse than one that says so and holds.
	sane.strategy = strategyOr(config.strategy, 'scalabus');

	if (sane.strategy !== config.strategy) {
		corrections.push(`strategy ${String(config.strategy)} -> ${sane.strategy}`);
	}

	return { config: sane, corrections };
}
