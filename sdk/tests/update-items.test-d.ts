import { assertType, describe, test } from 'vitest';
import {
	createDirectus,
	rest,
	updateItems,
	updateItemsBatch,
} from '../src/index.js';
import type { TestSchema } from './schema.js';

describe('onRepeatedPk on an update', () => {
	const restClient = createDirectus<TestSchema>('https://directus.example.com')
		.with(rest());

	test('a batch takes refuse or lastWins', () => {
		assertType(
			restClient.request(
				updateItemsBatch('collection_a', [{ id: 1 }], {
					onRepeatedPk: 'lastWins',
				}),
			),
		);

		assertType(
			restClient.request(
				updateItemsBatch('collection_a', [{ id: 1 }], {
					onRepeatedPk: 'refuse',
				}),
			),
		);
	});

	test('an update by keys takes lastWins', () => {
		assertType(
			restClient.request(
				updateItems('collection_a', [1, 1], { string_field: 'kept' }, {
					onRepeatedPk: 'lastWins',
				}),
			),
		);
	});

	test('an unknown answer is refused', () => {
		assertType(
			restClient.request(
				updateItemsBatch('collection_a', [{ id: 1 }], {
					fields: ['id'],
					// @ts-expect-error merge is not an answer onRepeatedPk takes
					onRepeatedPk: 'merge',
				}),
			),
		);
	});
});
