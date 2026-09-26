import {
	defineFeature as defineFeatureFromLibrary,
	loadFeature as loadFeatureFromLibrary,
	setJestCucumberConfiguration,
	type Options,
	type StepDefinitions,
} from 'jest-cucumber';
import { describe, test } from 'vitest';

// The blackbox suite runs vitest without `globals`, so `describe` and `test` are
// not on the global object jest-cucumber looks them up on.
setJestCucumberConfiguration({ runner: { describe, test } });

export type ParsedFeature = ReturnType<typeof loadFeatureFromLibrary>;
export type StepFunctions = Parameters<StepDefinitions>[0];
export type StepMatcher = string | RegExp;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type StepCallback = (...args: any[]) => any;
export type StepFunction = StepFunctions['given'] & {
	optional: StepFunctions['given'];
};

/**
 * A feature file, read relative to the blackbox root (vitest's working directory).
 *
 * `@only` is honoured file by file: a feature holding one keeps only what carries
 * the tag, and every other feature file still runs whole. `@skip` always drops a
 * scenario, whichever way the file was loaded.
 */
export function loadFeature(path: string, options?: Options): ParsedFeature {
	const onlyFilter = options?.tagFilter
		? `(${options.tagFilter}) and @only and not @skip`
		: '@only and not @skip';

	const featureWithOnly = loadFeatureFromLibrary(path, {
		...options,
		tagFilter: onlyFilter,
	});

	// The library never drops a scenario: it flags the ones the filter left out,
	// so what the file carries has to be read off the tags themselves.
	const carriesOnly = featureWithOnly.tags.includes('@only')
		|| featureWithOnly.scenarios.some((scenario) => {
			return scenario.tags.includes('@only');
		})
		|| featureWithOnly.scenarioOutlines.some((outline) => {
			return outline.tags.includes('@only');
		});

	if (carriesOnly) {
		return featureWithOnly;
	}

	return loadFeatureFromLibrary(path, {
		...options,
		tagFilter: options?.tagFilter
			? `(${options.tagFilter}) and not @skip`
			: 'not @skip',
	});
}

/**
 * The library's `defineFeature`, with `.optional` added to every step function.
 *
 * A step defined with `.optional` binds when the scenario holds it and is passed
 * over when it does not, which lets one steps callback serve scenarios that share
 * most of their steps without the library's "step not found" error.
 */
export function defineFeature(
	feature: ParsedFeature,
	defineScenarios: Parameters<typeof defineFeatureFromLibrary>[1],
): void {
	return defineFeatureFromLibrary(feature, (defineScenario) => {
		const defineScenarioWithOptionalSteps = (
			scenarioTitle: Parameters<typeof defineScenario>[0],
			stepsCallback: Parameters<typeof defineScenario>[1],
			timeout?: number,
		) => {
			return defineScenario(
				scenarioTitle,
				(stepFunctions) => {
					return stepsCallback(withOptionalSteps(
						feature,
						String(scenarioTitle),
						stepFunctions,
					));
				},
				timeout,
			);
		};

		return defineScenarios(
			defineScenarioWithOptionalSteps as typeof defineScenario,
		);
	});
}

const STEP_KEYWORDS = [
	'defineStep',
	'given',
	'when',
	'then',
	'and',
	'but',
] as const;

function withOptionalSteps(
	feature: ParsedFeature,
	scenarioTitle: string,
	stepFunctions: StepFunctions,
): StepFunctions {
	const withOptional = { ...stepFunctions } as Record<string, unknown>;

	for (const keyword of STEP_KEYWORDS) {
		const step = stepFunctions[keyword];

		const stepWithOptional = ((
			stepMatcher: StepMatcher,
			stepCallback: StepCallback,
		) => {
			return step(stepMatcher, stepCallback);
		}) as StepFunction;

		stepWithOptional.optional = (
			stepMatcher: StepMatcher,
			stepCallback: StepCallback,
		) => {
			if (!scenarioDeclares(feature, scenarioTitle, stepMatcher)) {
				return;
			}

			return step(stepMatcher, stepCallback);
		};

		withOptional[keyword] = stepWithOptional;
	}

	return withOptional as StepFunctions;
}

function scenarioDeclares(
	feature: ParsedFeature,
	scenarioTitle: string,
	stepMatcher: StepMatcher,
): boolean {
	const scenario = feature.scenarios.find((candidate) => {
		return candidate.title === scenarioTitle;
	}) ?? feature.scenarioOutlines.find((candidate) => {
		return candidate.title === scenarioTitle;
	});

	if (!scenario) {
		throw new Error(
			`Scenario '${scenarioTitle}' is in neither the feature's scenarios `
			+ `nor its scenario outlines`,
		);
	}

	return scenario.steps.some((step) => {
		return typeof stepMatcher === 'string'
			? step.stepText === stepMatcher
			: stepMatcher.test(step.stepText);
	});
}

/**
 * A Gherkin data table with every cell read as JSON, and an empty cell as `null`.
 *
 * A cell that is not valid JSON is kept as the string it was written as, so
 * `| spaced_repetition |` stays a string while `| 12 |` and `| ["a","b"] |` come
 * back as the number and the array the scenario meant. A quoted cell is a JSON
 * string, so `| "7" |` and `| "null" |` stay the strings `'7'` and `'null'`.
 */
export function parseGherkinTable<Row extends Record<string, unknown>>(
	rows: Record<string, string>[],
): Row[] {
	return rows.map((row) => {
		return Object.fromEntries(
			Object.entries(row).map(([column, value]) => {
				if (value === '') {
					return [column, null];
				}

				try {
					return [column, JSON.parse(value)];
				}
				catch {
					return [column, value];
				}
			}),
		) as Row;
	});
}
