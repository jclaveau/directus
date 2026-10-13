import { assertType, describe, test } from 'vitest';
import {
	createDirectus,
	rest,
	updateItems,
	updateItemsBatch,
} from '../src/index.js';
import type { TestSchema } from './schema.js';

describe('onRepeatedRow on an update', () => {
	const client = createDirectus<TestSchema>('https://directus.example.com').with(rest());

	test('a batch takes refuse or lastWins', () => {
		assertType(
			client.request(
				updateItemsBatch('collection_a', [{ id: 1 }], {
					onRepeatedRow: 'lastWins',
				}),
			),
		);

		assertType(
			client.request(
				updateItemsBatch('collection_a', [{ id: 1 }], {
					onRepeatedRow: 'refuse',
				}),
			),
		);
	});

	test('an update by keys takes lastWins', () => {
		assertType(
			client.request(
				updateItems('collection_a', [1, 1], { string_field: 'kept' }, {
					onRepeatedRow: 'lastWins',
				}),
			),
		);
	});

	test('an unknown answer is refused', () => {
		assertType(
			client.request(
				updateItemsBatch('collection_a', [{ id: 1 }], {
					fields: ['id'],
					// @ts-expect-error merge is not an answer onRepeatedRow takes
					onRepeatedRow: 'merge',
				}),
			),
		);
	});
});
