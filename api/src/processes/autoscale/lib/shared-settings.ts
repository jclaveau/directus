import { InvalidPayloadError } from '@directus/errors';
import type { AutoscaleConfig } from '@directus/types';

/**
 * What a field of the shared settings may hold, so a bad write fails at the door.
 */
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
 * What the shared settings carry besides the configuration itself.
 *
 * The loop takes only the fields it knows, so these ride in the same object
 * without reaching it. They are what turns a forgotten `{"enabled": false}`
 * into one an operator can date and attribute — to a person, and to the
 * surface they used — which is the failure this feature invites and the log
 * line it would otherwise take to answer.
 */
const NOTE_FIELDS = ['setBy', 'setAt', 'setFrom', 'note'];

export interface AutoscaleSharedSettings {
	[field: string]: unknown;
}

/**
 * The patch, checked field by field.
 *
 * A value the loop would silently drop has to fail here instead: an operator
 * who typed a ceiling and watched the pool ignore it has no way to tell a
 * rejected write from a clamped one. Bounds are not checked — those the loop
 * corrects, and it reports what it corrected them to.
 */
export function parseSharedSettingsPatch(
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
		// single value is handed back without dropping the whole shared settings.
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
 * The shared settings with the patch applied, a `null` value removing its field.
 *
 * Shared settings that end up holding nothing but their own note are removed
 * altogether: a page reading them would otherwise show a deployment as
 * carrying some while every value it runs on comes from its environment.
 */
export function applySharedSettingsPatch(
	sharedSettings: AutoscaleSharedSettings | null,
	patch: Record<string, unknown>,
): AutoscaleSharedSettings | null {
	const merged: AutoscaleSharedSettings = { ...sharedSettings };

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
