import { InvalidPayloadError } from '@directus/errors';
import type { AutoscaleConfig } from '@directus/types';
import { LEGACY_SAMPLE_WINDOW, MAX_SUPPORTED_WORKERS } from './sanitize-config.js';

/**
 * The longest any of the pacing fields may be asked for, in seconds.
 *
 * A day, which no cooldown is: past it the number is a duration typed in
 * milliseconds, and a cooldown of `300000` freezes the pool for three and a
 * half days without ever looking wrong in a list of numbers.
 */
export const MAX_PACING_SECONDS = 86_400;

interface Bound {
	low: number;
	high: number;
	/** What the number counts, so the message reads as the field does. */
	unit: string;
}

const BOUNDS: Record<string, Bound> = {
	sampleWindow: { low: 1, high: LEGACY_SAMPLE_WINDOW, unit: 'samples' },
	scaleCpuThreshold: { low: 1, high: 100, unit: '%' },
	releaseCpuThreshold: { low: 0, high: 99, unit: '%' },
	minWorkers: { low: 1, high: MAX_SUPPORTED_WORKERS, unit: 'workers' },
	maxWorkers: { low: 1, high: MAX_SUPPORTED_WORKERS, unit: 'workers' },
	prewarmWorkers: { low: 0, high: MAX_SUPPORTED_WORKERS, unit: 'workers' },
	minSecondsToScaleUp: { low: 0, high: MAX_PACING_SECONDS, unit: 'seconds' },
	minSecondsToScaleDown: { low: 0, high: MAX_PACING_SECONDS, unit: 'seconds' },
	warmupSeconds: { low: 0, high: MAX_PACING_SECONDS, unit: 'seconds' },
};

/**
 * Everything wrong with a configuration, in the words of the fields it names.
 *
 * The loop clamps rather than refuses, because it has to act on whatever the
 * environment and the key hold — it cannot answer anyone. A write can, and
 * silently correcting one is the worse failure of the two: an operator who
 * raised a ceiling during an incident and watched the pool ignore it has no
 * way to tell a corrected value from a refused one.
 *
 * Judged on the whole configuration, not on the patch: a floor is only too
 * high against the ceiling it will actually sit under, and that ceiling is
 * usually a field nobody is changing.
 */
export function configProblems(config: AutoscaleConfig): string[] {
	const problems: string[] = [];

	for (const [field, bound] of Object.entries(BOUNDS)) {
		const value = config[field as keyof AutoscaleConfig] as number;

		if (Number.isInteger(value) === false) {
			problems.push(`'${field}' has to be a whole number of ${bound.unit}`);
			continue;
		}

		if (value < bound.low || value > bound.high) {
			problems.push(
				`'${field}' is ${value} and has to be between `
					+ `${bound.low} and ${bound.high} ${bound.unit}`,
			);
		}
	}

	// The app is looked up by this name, and pm2 answers a name it does not
	// know with nothing: the loop reports a pool of no workers and holds.
	if (config.appName.trim() === '') {
		problems.push(`'appName' has to name the pm2 app to scale`);
	}

	// The ceiling stands for what the box holds. A floor above it asks for
	// workers there is no room for, and the two then correct each other on
	// alternate ticks, neither of them waiting for a cooldown.
	if (config.minWorkers > config.maxWorkers) {
		problems.push(
			`'minWorkers' is ${config.minWorkers}, above the 'maxWorkers' `
				+ `ceiling of ${config.maxWorkers}`,
		);
	}

	// Prewarming past the ceiling asks for a pool the next tick immediately
	// takes back down, so the deploy pays for workers it cannot keep.
	if (config.prewarmWorkers > config.maxWorkers) {
		problems.push(
			`'prewarmWorkers' is ${config.prewarmWorkers}, above the `
				+ `'maxWorkers' ceiling of ${config.maxWorkers}`,
		);
	}

	// A release threshold at or above the scale threshold leaves a reading
	// that is both too hot to grow and too cold to hold: at the ceiling the
	// add branch is skipped for want of room, the release branch fires on the
	// same reading, and the worker comes straight back.
	if (config.releaseCpuThreshold >= config.scaleCpuThreshold) {
		problems.push(
			`'releaseCpuThreshold' is ${config.releaseCpuThreshold}% and has to `
				+ `stay under the 'scaleCpuThreshold' of ${config.scaleCpuThreshold}%`,
		);
	}

	return problems;
}

/** The same, as the answer a write gets: every problem at once, or nothing. */
export function assertUsableConfig(config: AutoscaleConfig): void {
	const problems = configProblems(config);

	if (problems.length > 0) {
		throw new InvalidPayloadError({ reason: problems.join('; ') });
	}
}
