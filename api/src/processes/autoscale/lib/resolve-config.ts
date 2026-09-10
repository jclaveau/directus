import { useEnv } from '@directus/env';
import { useLogger } from '../../../logger/index.js';
import {
	SHARED_SETTINGS_COLUMNS,
	onSharedSettingsChanged,
	readSharedSettings,
	type SharedSettings,
} from '../../lib/shared-settings.js';
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
 * deployment's environment would move it, or whether the shared settings are
 * holding it where it is — the two look identical in the resolved value.
 */
function sourcesOf(sharedSettings: Record<string, unknown>): AutoscaleConfigSources {
	const env = useEnv();
	const sources = {} as AutoscaleConfigSources;

	for (const field of Object.keys(ENV_KEYS) as (keyof AutoscaleConfig)[]) {
		let source: AutoscaleValueSource = 'default';

		if (env[ENV_KEYS[field]] !== undefined) {
			source = 'env';
		}

		if (sharedSettings[field] !== undefined && sharedSettings[field] !== null) {
			source = 'sharedSettings';
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
 * Only the fields the shared settings actually set are taken from them, so
 * raising
 * one threshold during an incident leaves the rest on the env chain rather
 * than resetting them to defaults nobody asked for.
 */
function withSharedSettings(
	base: AutoscaleConfig,
	sharedSettings: Record<string, unknown>,
): AutoscaleConfig {
	const merged = { ...base };

	for (const [field, value] of Object.entries(sharedSettings)) {
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
 * What the loop would run on with these shared settings laid over the
 * environment.
 *
 * The env chain read here is this process's rather than the scaling process's,
 * which is a different process with the same deployment's environment. It is
 * what a write has to be judged against: the field being changed is compared
 * with fields nobody is changing, and those come from the chain.
 */
export function configWithSharedSettings(
	sharedSettings: Record<string, unknown>,
): AutoscaleConfig {
	return withSharedSettings(sanitizeConfig(envConfig()).config, sharedSettings);
}

/**
 * How long the mirror may go unrefreshed before it re-reads unprompted.
 *
 * The announcement is what lands a change in a second; this is what lands it
 * at all on a node that missed one. A bus message is delivered at most once
 * and nothing replays it, so a floor is the difference between staleness that
 * heals and staleness that waits for a restart.
 */
const MIRROR_FLOOR_MS = 30_000;

let lastCorrections = '';
let lastAnnounced: string | null = null;
let lastBase: AutoscaleConfig | null = null;
let lastSources: AutoscaleConfigSources | null = null;
let sharedSettings: SharedSettings | null = null;
let readAt = 0;
let unreadable = false;

/**
 * Where each field of the configuration the last tick used came from.
 *
 * Held beside the configuration rather than returned with it because it
 * answers a different question — one the loop never asks and a page always
 * does.
 */
export function resolvedSources(): AutoscaleConfigSources {
	return lastSources ?? sourcesOf({});
}

/**
 * What the last tick would have run on with nothing stored.
 *
 * The page offers to clear a field, and the value that lands there is this
 * one — knowable only here, since the shared settings win over it everywhere
 * else.
 */
export function resolvedWithoutSharedSettings(): AutoscaleConfig {
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
 * Say what the pool is being tuned by, at boot and whenever that changes.
 *
 * Nothing stored gets a line of its own rather than silence: a layer that went
 * missing — a column cleared, a database restored from before it was written —
 * reads exactly like a deployment that never had one, and the difference
 * between them is a ceiling somebody raised to survive an incident.
 */
function announceSharedSettings(): void {
	const summary = sharedSettings === null
		? 'nothing stored, so the environment chain alone'
		: Object.keys(sharedSettings).join(', ');

	if (summary === lastAnnounced) {
		return;
	}

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
async function refreshSharedSettings(): Promise<void> {
	readAt = Date.now();

	try {
		sharedSettings = await readSharedSettings(SHARED_SETTINGS_COLUMNS.autoscale);
		unreadable = false;
		announceSharedSettings();
	}
	catch (error) {
		if (unreadable === false) {
			unreadable = true;

			useLogger().warn(
				error,
				'[autoscale] could not read the shared settings; '
					+ 'holding the last ones read',
			);
		}
	}
}

/**
 * Seed the mirror and keep it current.
 *
 * Awaited at boot so the first tick decides on what is stored rather than on
 * the environment it would fall back to — a pool that starts at the
 * environment's floor and climbs to a stored one has spent that climb short of
 * workers.
 */
export async function initSharedSettingsMirror(): Promise<void> {
	await refreshSharedSettings();
	announceSharedSettings();

	onSharedSettingsChanged(SHARED_SETTINGS_COLUMNS.autoscale, () => {
		void refreshSharedSettings();
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
export function resolveConfig(): AutoscaleConfig {
	if (Date.now() - readAt >= MIRROR_FLOOR_MS) {
		void refreshSharedSettings();
	}

	const fromEnv = envConfig();
	const stored = sharedSettings ?? {};

	const { config, corrections }
		= sanitizeConfig(withSharedSettings(fromEnv, stored));

	announce(corrections);
	lastBase = sanitizeConfig(fromEnv).config;
	lastSources = sourcesOf(stored);

	return config;
}
