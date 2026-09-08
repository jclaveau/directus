import { useEnv } from '@directus/env';
import { useLogger } from '../../logger/index.js';
import { redisConfigAvailable, useRedis } from '../../redis/index.js';
import type { AutoscaleConfig, AutoscaleSignal } from '../types.js';

/**
 * Where a live override is read from.
 *
 * Namespaced like the tag index, so two deployments sharing one Redis are
 * tuned separately rather than through each other.
 */
export function autoscaleConfigKey(): string {
	return `${useEnv()['CACHE_NAMESPACE']}:autoscale:config`;
}

const SIGNALS: AutoscaleSignal[] = ['average', 'max'];

function signalFromEnv(value: unknown): AutoscaleSignal {
	return SIGNALS.includes(value as AutoscaleSignal)
		? value as AutoscaleSignal
		: 'average';
}

function envConfig(): AutoscaleConfig {
	const env = useEnv();

	return {
		enabled: env['PM2_AUTOSCALE_ENABLED'] !== false,
		appName: String(env['PM2_AUTOSCALE_APP_NAME'] ?? 'api'),
		signal: signalFromEnv(env['PM2_AUTOSCALE_SIGNAL']),
		scaleCpuThreshold: Number(env['PM2_AUTOSCALE_SCALE_CPU_THRESHOLD'] ?? 60),
		releaseCpuThreshold: Number(
			env['PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD'] ?? 40,
		),
		minWorkers: Number(env['PM2_AUTOSCALE_MIN_WORKERS'] ?? 1),
		maxWorkers: Number(env['PM2_AUTOSCALE_MAX_WORKERS'] ?? 4),
		prewarmWorkers: Number(env['PM2_AUTOSCALE_PREWARM'] ?? 0),
		minSecondsToScaleUp: Number(
			env['PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER'] ?? 10,
		),
		minSecondsToScaleDown: Number(
			env['PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER'] ?? 300,
		),
	};
}

/**
 * Only the fields a live override actually sets are taken from it, so
 * raising one threshold during an incident leaves the rest on the env chain
 * rather than resetting them to defaults nobody asked for.
 */
function withOverride(
	base: AutoscaleConfig,
	override: Record<string, unknown>,
): AutoscaleConfig {
	const merged = { ...base };

	for (const [field, value] of Object.entries(override)) {
		if (value === null || value === undefined) {
			continue;
		}

		if (field in base === false) {
			continue;
		}

		const current = base[field as keyof AutoscaleConfig];

		if (typeof current === 'number' && Number.isFinite(Number(value))) {
			Object.assign(merged, { [field]: Number(value) });
		}
		else if (typeof current === 'boolean') {
			Object.assign(merged, { [field]: value === true || value === 'true' });
		}
		else if (typeof current === 'string' && typeof value === 'string') {
			Object.assign(merged, { [field]: value });
		}
	}

	return merged;
}

let overrideUnreadable = false;

/**
 * The configuration for this tick: the env chain, with whatever Redis
 * currently holds laid over it.
 *
 * Tuning an autoscaler by redeploying restarts the pool, which destroys the
 * state being tuned, so the values have to be changeable without one. Redis
 * being unreachable is not a reason to stop scaling — the env chain is a
 * complete configuration on its own — and the warning is issued once per
 * outage rather than once per tick.
 */
export async function resolveConfig(): Promise<AutoscaleConfig> {
	const fromEnv = envConfig();

	if (redisConfigAvailable() === false) {
		return fromEnv;
	}

	try {
		const stored = await useRedis().get(autoscaleConfigKey());
		overrideUnreadable = false;

		if (!stored) {
			return fromEnv;
		}

		return withOverride(fromEnv, JSON.parse(stored) as Record<string, unknown>);
	}
	catch (error) {
		if (overrideUnreadable === false) {
			overrideUnreadable = true;

			useLogger().warn(
				error,
				'Could not read the autoscale override; using the env chain',
			);
		}

		return fromEnv;
	}
}
