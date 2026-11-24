/**
 * A `<name>` a response cell meets before any row stored it stands for the
 * uuid the response holds at that spot: the step binds it to the received
 * value, and later rows reuse it like any `<name>`. A spot holding anything
 * but a uuid is refused, never matched.
 *
 * ```yaml
 * headers:
 *   x-scoped-cache-purged-tags:
 *     - directus_invites
 *     - directus_invites:id=<new-invite>
 * ```
 *
 * binds `new-invite` to the id the purged tag names.
 */

import { expect } from 'vitest';

const UUID_PATTERN
	= /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;

const CAPTURE_MARKER_PATTERN = /__capture__([\w-]+)__/g;

export function captureNamesOf(
	responseText: string,
	keysByName: Record<string, string>,
) {
	const placeholderMatches = [...responseText.matchAll(/<([\w-]+)(:upper)?>/g)];

	const captureNames = placeholderMatches.filter(([, name]) => {
		return name !== 'run' && keysByName[name!] === undefined;
	});

	for (const [placeholder, , upperSuffix] of captureNames) {
		if (upperSuffix !== undefined) {
			throw new Error(
				`Placeholder ${JSON.stringify(placeholder)} is met first in a`
				+ ' response, where only a lower-case uuid is captured',
			);
		}
	}

	return [...new Set(captureNames.map(([, name]) => name!))];
}

interface ScenarioSteps {
	title: string;
	steps: { stepText: string; stepArgument: unknown }[];
}

/**
 * A capture binds any uuid at its spot: met nowhere else in its scenario, it
 * checks nothing, and is most often a key's name misspelt.
 *
 * ```
 * keys: { editor-role }    response cell: role: <editor_role>
 * → Placeholder "<editor_role>" in a response of "…" is met nowhere else
 * ```
 */
export function refuseLoneCaptures(scenarios: ScenarioSteps[]) {
	for (const { title, steps } of scenarios) {
		const scenarioText = steps
			.flatMap(({ stepText, stepArgument }) => {
				return Array.isArray(stepArgument)
					? [stepText, ...stepArgument.flatMap(Object.values)]
					: [stepText, String(stepArgument)];
			})
			.join('\n');

		const responseCells = steps.flatMap(({ stepArgument }) => {
			return Array.isArray(stepArgument)
				? stepArgument.map((tableRow) => tableRow?.response)
				: [];
		});

		for (const responseCell of responseCells) {
			if (typeof responseCell !== 'string') {
				continue;
			}

			for (const [, name] of responseCell.matchAll(/<([\w-]+)>/g)) {
				// A request names a key it remembers bare, not as `<name>`.
				const nameUses = scenarioText.match(new RegExp(
					`<${name}(:upper)?>|remember(_session)?: ${name}$`
					+ `|remember_headers:(\\n +[\\w-]+: .*)*\\n +${name}:`,
					'gm',
				));

				if (name !== 'run' && nameUses!.length === 1) {
					throw new Error(
						`Placeholder ${JSON.stringify(`<${name}>`)} in a response of`
						+ ` ${JSON.stringify(title)} is met nowhere else in it: a`
						+ ' capture nothing reuses checks nothing',
					);
				}
			}
		}
	}
}

// Each capture is spelled as a marker the key substitution leaves alone.
export function markedCaptures(responseText: string, captureNames: string[]) {
	return responseText.replaceAll(/<([\w-]+)>/g, (placeholder, name: string) => {
		return captureNames.includes(name)
			? `__capture__${name}__`
			: placeholder;
	});
}

export function bindCaptures(
	expectedPart: unknown,
	receivedPart: unknown,
	keysByName: Record<string, string>,
	captureNames: string[],
) {
	try {
		bindPartCaptures(expectedPart, receivedPart, keysByName);

		for (const captureName of captureNames) {
			if (keysByName[captureName] === undefined) {
				throw new Error(
					`Placeholder ${JSON.stringify(`<${captureName}>`)} finds no spot`
					+ ` in the response: ${JSON.stringify(receivedPart)}`,
				);
			}
		}
	}
	catch (captureError) {
		// A wrong response holds no uuid at the spot either: its diff, which
		// the capture error would hide, fails the step first.
		expect(receivedPart).toMatchObject(
			capturePatternsOf(expectedPart) as object,
		);

		throw captureError;
	}
}

// The cell with each capture turned into the text it accepts at its spot.
function capturePatternsOf(expectedPart: unknown): unknown {
	if (typeof expectedPart === 'string') {
		return expectedPart.match(CAPTURE_MARKER_PATTERN) === null
			? expectedPart
			: expect.stringMatching(markerPatternOf(expectedPart));
	}

	if (Array.isArray(expectedPart)) {
		const expectedItems = expectedPart.map(capturePatternsOf);

		// A list of strings is order-free, as `bindListCaptures` reads it.
		return expectedPart.every((expectedItem) => typeof expectedItem === 'string')
			? expect.arrayContaining(expectedItems)
			: expectedItems;
	}

	if (expectedPart === null || typeof expectedPart !== 'object') {
		return expectedPart;
	}

	return Object.fromEntries(Object.entries(expectedPart)
		.map(([partKey, expectedValue]) => {
			return [partKey, capturePatternsOf(expectedValue)];
		}));
}

function bindPartCaptures(
	expectedPart: unknown,
	receivedPart: unknown,
	keysByName: Record<string, string>,
) {
	if (typeof expectedPart === 'string') {
		bindTextCaptures(expectedPart, receivedPart, keysByName);

		return;
	}

	if (Array.isArray(expectedPart)) {
		if (!Array.isArray(receivedPart)) {
			return;
		}

		if (expectedPart.every((expectedItem) => typeof expectedItem === 'string')) {
			bindListCaptures(expectedPart, receivedPart, keysByName);

			return;
		}

		expectedPart.forEach((expectedItem, itemIndex) => {
			bindPartCaptures(expectedItem, receivedPart[itemIndex], keysByName);
		});

		return;
	}

	if (expectedPart === null || typeof expectedPart !== 'object') {
		return;
	}

	if (receivedPart === null || typeof receivedPart !== 'object') {
		return;
	}

	for (const [partKey, expectedValue] of Object.entries(expectedPart)) {
		bindPartCaptures(
			expectedValue,
			(receivedPart as Record<string, unknown>)[partKey],
			keysByName,
		);
	}
}

// A list of strings is order-free, as a comma-separated header is: an item
// with a capture matches the one received item no plain item states.
function bindListCaptures(
	expectedItems: string[],
	receivedItems: unknown[],
	keysByName: Record<string, string>,
) {
	const unclaimedItems = receivedItems.filter((receivedItem) => {
		return !expectedItems.includes(receivedItem as string);
	});

	for (const expectedItem of expectedItems) {
		if (expectedItem.match(CAPTURE_MARKER_PATTERN) === null) {
			continue;
		}

		const matchingItems = unclaimedItems.filter((receivedItem) => {
			return typeof receivedItem === 'string'
				&& markerPatternOf(expectedItem).test(receivedItem);
		});

		if (matchingItems.length > 1) {
			throw new Error(
				`Placeholder item ${JSON.stringify(
					expectedItem.replaceAll(CAPTURE_MARKER_PATTERN, '<$1>'),
				)}`
				+ ` matches several received items: ${JSON.stringify(matchingItems)}`,
			);
		}

		if (matchingItems.length === 1) {
			bindTextCaptures(expectedItem, matchingItems[0], keysByName);
		}
	}
}

function bindTextCaptures(
	expectedText: string,
	receivedValue: unknown,
	keysByName: Record<string, string>,
) {
	const captureNames = [...expectedText.matchAll(CAPTURE_MARKER_PATTERN)]
		.map(([, captureName]) => captureName!);

	if (captureNames.length === 0) {
		return;
	}

	const textMatch = typeof receivedValue === 'string'
		? markerPatternOf(expectedText).exec(receivedValue)
		: null;

	captureNames.forEach((captureName, captureIndex) => {
		const capturedValue = textMatch?.[captureIndex + 1];

		if (capturedValue === undefined || !UUID_PATTERN.test(capturedValue)) {
			throw new Error(
				`Placeholder ${JSON.stringify(`<${captureName}>`)} captures only a`
				+ ` uuid, received ${JSON.stringify(receivedValue)}`,
			);
		}

		if (
			keysByName[captureName] !== undefined
			&& keysByName[captureName] !== capturedValue
		) {
			throw new Error(
				`Placeholder ${JSON.stringify(`<${captureName}>`)} captures`
				+ ` ${JSON.stringify(capturedValue)} after`
				+ ` ${JSON.stringify(keysByName[captureName])}`,
			);
		}

		keysByName[captureName] = capturedValue;
	});
}

function markerPatternOf(expectedText: string) {
	return new RegExp(`^${expectedText
		.split(CAPTURE_MARKER_PATTERN)
		.map((textPart, partIndex) => {
			// split keeps each marker's name at the odd indexes.
			return partIndex % 2 === 1
				? '(.+?)'
				: textPart.replaceAll(/[$()*+.?[\\\]^{|}]/g, '\\$&');
		})
		.join('')}$`);
}
