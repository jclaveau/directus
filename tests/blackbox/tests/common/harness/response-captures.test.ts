import {
	defineFeature,
	loadFeature,
	type StepFunctions,
} from '@common/cucumber';
import {
	bindCaptures,
	captureNamesOf,
	markedCaptures,
} from '@common/response-captures';
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
	});
});
