import { InvalidPayloadError } from '@directus/errors';
import type { AutoscaleConfig } from '@directus/types';
import { useRedis } from '../../redis/index.js';
import { autoscaleConfigKey } from './resolve-config.js';

/** What a field of the shared config may hold, so a bad write fails at the door. */
type FieldType = string[] | 'boolean' | 'number' | 'string';

const FIELD_TYPES: Record<keyof AutoscaleConfig, FieldType> = {
	enabled: 'boolean',
	strategy: ['scalabus', 'legacy'],
	appName: 'string',
	signal: ['average', 'max'],
	sampleWindow: 'number',
	scaleCpuThreshold: 'number',
	releaseCpuThreshold: 'number',
	minWorkers: 'number',
	maxWorkers: 'number',
	prewarmWorkers: 'number',
	minSecondsToScaleUp: 'number',
	minSecondsToScaleDown: 'number',
	warmupSeconds: 'number',
};

/**
 * What the shared config carries besides the configuration itself.
 *
 * The loop takes only the fields it knows, so these ride in the same object
 * without reaching it. They are what turns a forgotten `{"enabled": false}`
 * into one an operator can date and attribute — to a person, and to the
 * surface they used — which is the failure this feature invites and the log
 * line it would otherwise take to answer.
 */
const NOTE_FIELDS = ['setBy', 'setAt', 'setFrom', 'note'];

export interface AutoscaleSharedConfig {
	[field: string]: unknown;
}

/** The shared config as it stands, or `null` where nothing is set for anything. */
export async function readSharedConfig(): Promise<AutoscaleSharedConfig | null> {
	const stored = await useRedis().get(autoscaleConfigKey());

	if (!stored) {
		return null;
	}

	try {
		const parsed: unknown = JSON.parse(stored);

		return typeof parsed === 'object' && parsed !== null
			? parsed as AutoscaleSharedConfig
			: null;
	}
	catch {
		// A key edited by hand into something unparseable is reported as no
		// shared config, which is what the loop makes of it too.
		return null;
	}
}

/**
 * The patch, checked field by field.
 *
 * A value the loop would silently drop has to fail here instead: an operator
 * who typed a ceiling and watched the pool ignore it has no way to tell a
 * rejected write from a clamped one. Bounds are not checked — those the loop
 * corrects, and it reports what it corrected them to.
 */
export function parseSharedConfigPatch(
	patch: Record<string, unknown>,
): Record<string, unknown> {
	const parsed: Record<string, unknown> = {};

	for (const [field, value] of Object.entries(patch)) {
		if (NOTE_FIELDS.includes(field)) {
			if (value !== null && typeof value !== 'string') {
				throw new InvalidPayloadError({
					reason: `'${field}' has to be a string`,
				});
			}

			parsed[field] = value;
			continue;
		}

		// Read as an own property: `constructor` and `toString` are answered by
		// every object, and one reaching the branches below would be checked
		// against a function rather than named as no field of the configuration.
		const expected = Object.hasOwn(FIELD_TYPES, field)
			? FIELD_TYPES[field as keyof AutoscaleConfig]
			: undefined;

		if (expected === undefined) {
			throw new InvalidPayloadError({
				reason: `'${field}' is not a field of the autoscale configuration`,
			});
		}

		// Null clears one field back to the environment chain, which is how a
		// single value is handed back without dropping the whole shared config.
		if (value === null) {
			parsed[field] = null;
			continue;
		}

		if (Array.isArray(expected)) {
			if (expected.includes(value as string) === false) {
				throw new InvalidPayloadError({
					reason: `'${field}' has to be one of ${expected.join(', ')}`,
				});
			}
		}
		else if (expected === 'number') {
			const usable = typeof value === 'number'
				&& Number.isFinite(value)
				&& value >= 0;

			if (usable === false) {
				throw new InvalidPayloadError({
					reason: `'${field}' has to be a number of zero or more`,
				});
			}
		}
		else if (typeof value !== expected) {
			throw new InvalidPayloadError({
				reason: `'${field}' has to be a ${expected}`,
			});
		}

		parsed[field] = value;
	}

	return parsed;
}

/**
 * The shared config with the patch applied, a `null` value removing its field.
 *
 * A shared config that ends up holding nothing but its own note is removed
 * altogether: a page reading it would otherwise show a deployment as carrying
 * one while every value it runs on comes from its environment.
 */
export function applySharedConfigPatch(
	sharedConfig: AutoscaleSharedConfig | null,
	patch: Record<string, unknown>,
): AutoscaleSharedConfig | null {
	const merged: AutoscaleSharedConfig = { ...sharedConfig };

	for (const [field, value] of Object.entries(patch)) {
		if (value === null) {
			delete merged[field];
		}
		else {
			merged[field] = value;
		}
	}

	const configured = Object.keys(merged)
		.filter((field) => NOTE_FIELDS.includes(field) === false);

	return configured.length === 0
		? null
		: merged;
}

export async function writeSharedConfig(
	sharedConfig: AutoscaleSharedConfig | null,
): Promise<void> {
	const redis = useRedis();

	if (sharedConfig === null) {
		await redis.del(autoscaleConfigKey());
		return;
	}

	await redis.set(autoscaleConfigKey(), JSON.stringify(sharedConfig));
}
