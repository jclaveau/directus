import { useEnv } from '@directus/env';
import { useLogger } from '../../logger/index.js';
import { redisConfigAvailable, useRedis } from '../../redis/index.js';
import type { AutoscaleConfig } from '../types.js';
import {
	AUTOSCALE_DEFAULTS,
	numberOr,
	sanitizeConfig,
	signalOr,
	strategyOr,
} from './sanitize-config.js';

/**
 * Where a live override is read from.
 *
 * Namespaced like the tag index, so two deployments sharing one Redis are
 * tuned separately rather than through each other.
 */
export function autoscaleConfigKey(): string {
	return `${useEnv()['CACHE_NAMESPACE']}:autoscale:config`;
}

function envConfig(): AutoscaleConfig {
	const env = useEnv();

	return {
		enabled: env['PM2_AUTOSCALE_ENABLED'] !== false,
		strategy: strategyOr(env['PM2_AUTOSCALE_STRATEGY'], 'scalabus'),
		appName: String(env['PM2_AUTOSCALE_APP_NAME'] ?? 'api'),
		signal: signalOr(env['PM2_AUTOSCALE_SIGNAL'], 'average'),
		scaleCpuThreshold: numberOr(
			env['PM2_AUTOSCALE_SCALE_CPU_THRESHOLD'],
			AUTOSCALE_DEFAULTS.scaleCpuThreshold,
		),
		releaseCpuThreshold: numberOr(
			env['PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD'],
			AUTOSCALE_DEFAULTS.releaseCpuThreshold,
		),
		minWorkers: numberOr(
			env['PM2_AUTOSCALE_MIN_WORKERS'],
			AUTOSCALE_DEFAULTS.minWorkers,
		),
		maxWorkers: numberOr(
			env['PM2_AUTOSCALE_MAX_WORKERS'],
			AUTOSCALE_DEFAULTS.maxWorkers,
		),
		prewarmWorkers: numberOr(
			env['PM2_AUTOSCALE_PREWARM'],
			AUTOSCALE_DEFAULTS.prewarmWorkers,
		),
		minSecondsToScaleUp: numberOr(
			env['PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER'],
			AUTOSCALE_DEFAULTS.minSecondsToScaleUp,
		),
		minSecondsToScaleDown: numberOr(
			env['PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER'],
			AUTOSCALE_DEFAULTS.minSecondsToScaleDown,
		),
		warmupSeconds: numberOr(
			env['PM2_AUTOSCALE_WARMUP_SECONDS'],
			AUTOSCALE_DEFAULTS.warmupSeconds,
		),
	};
}

/**
 * Only the fields a live override actually sets are taken from it, so raising
 * one threshold during an incident leaves the rest on the env chain rather
 * than resetting them to defaults nobody asked for.
 */
function withOverride(
	base: AutoscaleConfig,
	override: Record<string, unknown>,
): AutoscaleConfig {
	const merged = { ...base };

	for (const [field, value] of Object.entries(override)) {
		if (Object.hasOwn(base, field) === false) {
			continue;
		}

		if (value === null || value === undefined) {
			continue;
		}

		const current = base[field as keyof AutoscaleConfig];

		if (typeof current === 'number') {
			Object.assign(merged, { [field]: numberOr(value, current) });
		}
		else if (typeof current === 'boolean') {
			Object.assign(merged, { [field]: value === true || value === 'true' });
		}
		else if (field === 'signal') {
			Object.assign(merged, { [field]: signalOr(value, base.signal) });
		}
		else if (field === 'strategy') {
			Object.assign(merged, { [field]: strategyOr(value, base.strategy) });
		}
		else if (typeof current === 'string' && typeof value === 'string') {
			Object.assign(merged, { [field]: value });
		}
	}

	return merged;
}

let lastCorrections = '';
let lastGood: AutoscaleConfig | null = null;
let overrideUnreadable = false;

function announce(corrections: string[]): void {
	const summary = corrections.join(', ');

	if (summary === lastCorrections) {
		return;
	}

	lastCorrections = summary;

	if (summary !== '') {
		useLogger().warn(`[autoscale] configuration corrected: ${summary}`);
	}
}

/**
 * The configuration for this tick: the env chain, with whatever Redis
 * currently holds laid over it, checked before the loop is allowed to act
 * on it.
 *
 * Tuning an autoscaler by redeploying restarts the pool, which destroys the
 * state being tuned, so the values have to be changeable without one.
 *
 * A Redis that cannot be read keeps the last configuration that was, rather
 * than reverting to the env chain. Reverting sounds safer and is not: an
 * operator who has just raised the ceiling to survive a spike would have it
 * dropped back by a blip, and the ceiling is corrected with no cooldown — the
 * pool would lose the workers immediately and take them back when Redis
 * returned.
 */
export async function resolveConfig(): Promise<AutoscaleConfig> {
	const fromEnv = envConfig();

	const settle = (candidate: AutoscaleConfig) => {
		const { config, corrections } = sanitizeConfig(candidate);
		announce(corrections);
		lastGood = config;

		return config;
	};

	if (redisConfigAvailable() === false) {
		return settle(fromEnv);
	}

	try {
		const stored = await useRedis().get(autoscaleConfigKey());
		overrideUnreadable = false;

		if (!stored) {
			return settle(fromEnv);
		}

		return settle(
			withOverride(fromEnv, JSON.parse(stored) as Record<string, unknown>),
		);
	}
	catch (error) {
		if (overrideUnreadable === false) {
			overrideUnreadable = true;

			useLogger().warn(
				error,
				'[autoscale] could not read the override; holding the last configuration',
			);
		}

		return lastGood ?? settle(fromEnv);
	}
}
