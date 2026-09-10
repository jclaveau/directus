import { useEnv } from '@directus/env';
import { useLogger } from '../../logger/index.js';
import { redisConfigAvailable, useRedis } from '../../redis/index.js';
import type {
	AutoscaleConfig,
	AutoscaleConfigSources,
	AutoscaleValueSource,
} from '@directus/types';
import {
	AUTOSCALE_DEFAULTS,
	numberOr,
	sanitizeConfig,
	signalOr,
	strategyOr,
} from './sanitize-config.js';

/**
 * Where the shared config is read from.
 *
 * Namespaced like the tag index, so two deployments sharing one Redis are
 * tuned separately rather than through each other.
 */
export function autoscaleConfigKey(): string {
	return `${useEnv()['CACHE_NAMESPACE']}:config:pm2`;
}

/**
 * Where the pm2 options an operator may change are kept.
 *
 * Its own key rather than a corner of the configuration's: the loop reads that
 * one every tick and takes no interest in these, which reach the pool through
 * a rolling restart instead.
 */
export function supervisorSharedConfigKey(): string {
	return `${useEnv()['CACHE_NAMESPACE']}:config:pm2:supervisor`;
}

/** The variable each field reads, so a page can say where a value came from. */
const ENV_KEYS: Record<keyof AutoscaleConfig, string> = {
	enabled: 'PM2_AUTOSCALE_ENABLED',
	strategy: 'PM2_AUTOSCALE_STRATEGY',
	appName: 'PM2_AUTOSCALE_APP_NAME',
	signal: 'PM2_AUTOSCALE_SIGNAL',
	sampleWindow: 'PM2_AUTOSCALE_SAMPLE_WINDOW',
	scaleCpuThreshold: 'PM2_AUTOSCALE_SCALE_CPU_THRESHOLD',
	releaseCpuThreshold: 'PM2_AUTOSCALE_RELEASE_CPU_THRESHOLD',
	minWorkers: 'PM2_AUTOSCALE_MIN_WORKERS',
	maxWorkers: 'PM2_AUTOSCALE_MAX_WORKERS',
	prewarmWorkers: 'PM2_AUTOSCALE_PREWARM',
	minSecondsToScaleUp: 'PM2_AUTOSCALE_MIN_SECONDS_TO_ADD_WORKER',
	minSecondsToScaleDown: 'PM2_AUTOSCALE_MIN_SECONDS_TO_RELEASE_WORKER',
	warmupSeconds: 'PM2_AUTOSCALE_WARMUP_SECONDS',
};

/**
 * Which layer each field's value came from.
 *
 * An operator reading a threshold needs to know whether changing the
 * deployment's environment would move it, or whether the shared config is
 * holding it where it is — the two look identical in the resolved value.
 */
function sourcesOf(sharedConfig: Record<string, unknown>): AutoscaleConfigSources {
	const env = useEnv();
	const sources = {} as AutoscaleConfigSources;

	for (const field of Object.keys(ENV_KEYS) as (keyof AutoscaleConfig)[]) {
		let source: AutoscaleValueSource = 'default';

		if (env[ENV_KEYS[field]] !== undefined) {
			source = 'env';
		}

		if (sharedConfig[field] !== undefined && sharedConfig[field] !== null) {
			source = 'sharedConfig';
		}

		sources[field] = source;
	}

	return sources;
}

/** The configuration this process's environment alone resolves. */
export function envConfig(): AutoscaleConfig {
	const env = useEnv();

	return {
		enabled: env['PM2_AUTOSCALE_ENABLED'] !== false,
		strategy: strategyOr(env['PM2_AUTOSCALE_STRATEGY'], 'scalabus'),
		appName: String(env['PM2_AUTOSCALE_APP_NAME'] ?? 'api'),
		signal: signalOr(env['PM2_AUTOSCALE_SIGNAL'], 'average'),
		sampleWindow: numberOr(
			env['PM2_AUTOSCALE_SAMPLE_WINDOW'],
			AUTOSCALE_DEFAULTS.sampleWindow,
		),
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
 * Only the fields the shared config actually sets are taken from it, so raising
 * one threshold during an incident leaves the rest on the env chain rather
 * than resetting them to defaults nobody asked for.
 */
function withSharedConfig(
	base: AutoscaleConfig,
	sharedConfig: Record<string, unknown>,
): AutoscaleConfig {
	const merged = { ...base };

	for (const [field, value] of Object.entries(sharedConfig)) {
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

/**
 * What the loop would run on with this shared config laid over the environment.
 *
 * The env chain read here is this process's rather than the scaling process's,
 * which is a different process with the same deployment's environment. It is
 * what a write has to be judged against: the field being changed is compared
 * with fields nobody is changing, and those come from the chain.
 */
export function configWithSharedConfig(
	sharedConfig: Record<string, unknown>,
): AutoscaleConfig {
	return withSharedConfig(sanitizeConfig(envConfig()).config, sharedConfig);
}

/**
 * How long a tick waits for the shared config before deciding without a fresh one.
 *
 * The interval between ticks, so a read is never the reason a tick is late.
 */
const SHARED_CONFIG_READ_TIMEOUT_MS = 1000;

/**
 * Statuses in which the client holds no connection to send a command down.
 *
 * Connecting is not among them: the first tick of a healthy boot happens
 * before the handshake finishes, and its read is answered as soon as it does.
 */
const DISCONNECTED = new Set(['reconnecting', 'close', 'end']);

/**
 * The stored shared config, or a failure if Redis does not produce one promptly.
 *
 * ioredis queues a command issued while it is not connected and puts no
 * deadline on that queue, so a tick that only awaited the read would hold the
 * loop for as long as the outage lasts — leaving the pool frozen at whatever
 * size the outage caught it at, which is exactly what this loop exists to
 * prevent.
 */
async function readStoredSharedConfig(): Promise<string | null> {
	const redis = useRedis();

	if (DISCONNECTED.has(redis.status)) {
		throw new Error(`the client is ${redis.status}`);
	}

	const read = redis.get(autoscaleConfigKey());

	// The read that loses the race stays queued, and ioredis rejects a queued
	// command when it flushes the queue — an unhandled rejection there would
	// end the process the loop runs in.
	read.catch(() => {});

	let expire: ReturnType<typeof setTimeout> | undefined;

	try {
		return await Promise.race([
			read,
			new Promise<never>((_resolve, reject) => {
				expire = setTimeout(() => {
					reject(new Error(`no answer in ${SHARED_CONFIG_READ_TIMEOUT_MS}ms`));
				}, SHARED_CONFIG_READ_TIMEOUT_MS);
			}),
		]);
	}
	finally {
		clearTimeout(expire);
	}
}

let lastCorrections = '';
let lastGood: AutoscaleConfig | null = null;
let lastBase: AutoscaleConfig | null = null;
let lastSources: AutoscaleConfigSources | null = null;
let sharedConfigUnreadable = false;

/**
 * Where each field of the configuration the last tick used came from.
 *
 * Held beside the configuration rather than returned with it because it
 * answers a different question — one the loop never asks and a page always
 * does — and because an unreadable shared config holds both together.
 */
export function resolvedSources(): AutoscaleConfigSources {
	return lastSources ?? sourcesOf({});
}

/**
 * What the last tick would have run on with nothing stored in Redis.
 *
 * The page offers to clear a field, and the value that lands there is this
 * one — knowable only here, since the shared config wins over it everywhere else.
 */
export function resolvedWithoutSharedConfig(): AutoscaleConfig {
	return lastBase ?? sanitizeConfig(envConfig()).config;
}

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

	const settle = (
		candidate: AutoscaleConfig,
		sharedConfig: Record<string, unknown>,
	) => {
		const { config, corrections } = sanitizeConfig(candidate);
		announce(corrections);
		lastGood = config;
		lastBase = sanitizeConfig(fromEnv).config;
		lastSources = sourcesOf(sharedConfig);

		return config;
	};

	if (redisConfigAvailable() === false) {
		return settle(fromEnv, {});
	}

	try {
		const stored = await readStoredSharedConfig();
		sharedConfigUnreadable = false;

		if (!stored) {
			return settle(fromEnv, {});
		}

		const sharedConfig = JSON.parse(stored) as Record<string, unknown>;

		return settle(withSharedConfig(fromEnv, sharedConfig), sharedConfig);
	}
	catch (error) {
		if (sharedConfigUnreadable === false) {
			sharedConfigUnreadable = true;

			useLogger().warn(
				error,
				'[autoscale] could not read the shared config; '
					+ 'holding the last configuration',
			);
		}

		return lastGood ?? settle(fromEnv, {});
	}
}
