import { InvalidPayloadError } from '@directus/errors';
import type { AutoscaleConfig } from '@directus/types';
import { expect, test } from 'vitest';
import { assertUsableConfig, configProblems } from './validate-config.js';

function config(overrides: Partial<AutoscaleConfig> = {}): AutoscaleConfig {
	return {
		enabled: true,
		strategy: 'scalabus',
		appName: 'api',
		signal: 'average',
		sampleWindow: 5,
		scaleCpuThreshold: 60,
		releaseCpuThreshold: 40,
		minWorkers: 1,
		maxWorkers: 4,
		prewarmWorkers: 0,
		minSecondsToScaleUp: 10,
		minSecondsToScaleDown: 300,
		warmupSeconds: 30,
		...overrides,
	};
}

test('finds nothing wrong with a configuration the loop can run', () => {
	expect(configProblems(config())).toEqual([]);
});

// The ceiling stands for what the box holds, and the two left crossed correct
// each other on alternate ticks with no cooldown between them.
test('refuses a floor above the ceiling, naming both', () => {
	expect(configProblems(config({ minWorkers: 8, maxWorkers: 4 })))
		.toEqual([`'minWorkers' is 8, above the 'maxWorkers' ceiling of 4`]);

	expect(configProblems(config({ minWorkers: 4, maxWorkers: 4 })))
		.toEqual([]);
});

test('refuses prewarming past the ceiling', () => {
	expect(configProblems(config({ prewarmWorkers: 8, maxWorkers: 4 })))
		.toEqual([`'prewarmWorkers' is 8, above the 'maxWorkers' ceiling of 4`]);
});

// Equal is already broken: at the ceiling the add branch is skipped for want
// of room and the release branch fires on the same reading.
test('refuses a release threshold that is not under the scale one', () => {
	const crossed = { releaseCpuThreshold: 70, scaleCpuThreshold: 60 };

	expect(configProblems(config(crossed))).toEqual([
		`'releaseCpuThreshold' is 70% and has to stay under the `
			+ `'scaleCpuThreshold' of 60%`,
	]);

	expect(configProblems(config({ releaseCpuThreshold: 60 })))
		.toHaveLength(1);

	expect(configProblems(config({ releaseCpuThreshold: 59 })))
		.toEqual([]);
});

test.each([
	['maxWorkers', 65, `'maxWorkers' is 65 and has to be between 1 and 64 workers`],
	['maxWorkers', 0, `'maxWorkers' is 0 and has to be between 1 and 64 workers`],
	[
		'sampleWindow',
		31,
		`'sampleWindow' is 31 and has to be between 1 and 30 samples`,
	],
	[
		'scaleCpuThreshold',
		101,
		`'scaleCpuThreshold' is 101 and has to be between 1 and 100 %`,
	],
] as const)('refuses %s of %s', (field, value, reason) => {
	expect(configProblems(config({ [field]: value }))).toContain(reason);
});

// `300000` is a cooldown typed in milliseconds, which freezes the pool for
// three and a half days while reading like every other number in the list.
test('refuses a pacing field longer than a day', () => {
	expect(configProblems(config({ minSecondsToScaleDown: 300_000 })))
		.toEqual([
			`'minSecondsToScaleDown' is 300000 and has to be between `
				+ `0 and 86400 seconds`,
		]);
});

// The loop rounds what it is given, so half a worker is a value nobody asked
// for arriving as one nobody notices.
test('refuses a count that is not whole', () => {
	expect(configProblems(config({ minWorkers: 2.5 })))
		.toEqual([`'minWorkers' has to be a whole number of workers`]);
});

// pm2 answers a name it does not know with nothing, and the loop reports a
// pool of no workers and holds — which reads exactly like an idle deployment.
test('refuses a configuration that names no app', () => {
	expect(configProblems(config({ appName: '  ' })))
		.toEqual([`'appName' has to name the pm2 app to scale`]);
});

// A form applies every field at once, so answering the first problem alone
// would take as many round trips as there are mistakes.
test('answers with everything wrong at once', () => {
	const broken = config({ minWorkers: 8, maxWorkers: 4, sampleWindow: 90 });

	expect(configProblems(broken)).toHaveLength(2);

	expect(() => assertUsableConfig(broken))
		.toThrowError(InvalidPayloadError);

	expect(() => assertUsableConfig(broken))
		.toThrowError(/sampleWindow.*minWorkers/s);
});

test('lets a usable configuration through', () => {
	expect(() => assertUsableConfig(config())).not.toThrow();
});
