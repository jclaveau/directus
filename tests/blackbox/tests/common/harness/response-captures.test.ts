import {
	defineFeature,
	loadFeature,
	messageOfDocString,
	type StepFunctions,
} from '@common/cucumber';
import {
	bindCaptures,
	captureNamesOf,
	markedCaptures,
	refuseLoneCaptures,
} from '@common/response-captures';
import { parseFeature } from 'jest-cucumber';
import { load as loadYaml } from 'js-yaml';
import { describe, expect } from 'vitest';

const feature = loadFeature('./tests/common/harness/response-captures.feature');

describe('response captures', () => {
	defineFeature(feature, (scenario) => {
		let captureNames: string[] = [];
		let expectedResponse: unknown;
		let receivedResponse: unknown;

		const steps = ({ given, when, then }: StepFunctions) => {
			given(/^a response cell capturing <[\w-]+>:$/, (docString: string) => {
				captureNames = captureNamesOf(docString, {});
				expectedResponse = loadYaml(markedCaptures(docString, captureNames));
			});

			when('it meets this response:', (docString: string) => {
				receivedResponse = loadYaml(docString);
			});

			then('the step fails with the message:', (docString: string) => {
				expect(() => {
					bindCaptures(expectedResponse, receivedResponse, {}, captureNames);
				}).toThrowError(expect.objectContaining({ message: docString }));
			});
		};

		scenario('a refused request fails on its diff, not on its capture', steps);

		scenario(
			'a matching response holding no uuid at the spot fails on its capture',
			steps,
		);

		let featureText = '';

		const featureSteps = ({ given }: StepFunctions) => {
			given('a feature holding this scenario:', (docString: string) => {
				featureText = docString;
			});
		};

		scenario(
			'a capture met nowhere else in its scenario is refused, naming it',
			(stepFunctions) => {
				featureSteps(stepFunctions);

				stepFunctions.then(
					'loading it fails with the message:',
					(docString: string) => {
						expect(() => {
							refuseLoneCaptures(parseFeature(featureText).scenarios);
						}).toThrowError(new Error(messageOfDocString(docString)));
					},
				);
			},
		);

		scenario('a capture a later request reuses loads', (stepFunctions) => {
			featureSteps(stepFunctions);

			stepFunctions.then('loading it passes', () => {
				expect(() => {
					refuseLoneCaptures(parseFeature(featureText).scenarios);
				}).not.toThrow();
			});
		});
	});
});
