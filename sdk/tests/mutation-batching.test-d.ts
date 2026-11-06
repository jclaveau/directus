import { assertType, describe, test } from 'vitest';
import {
	createDirectus,
	createItem,
	createItems,
	createUsers,
	rest,
	updateItem,
	updateItems,
	updateItemsBatch,
	updateSettings,
} from '../src/index.js';
import type { TestSchema } from './schema.js';

describe('mutationBatching on a create or an update', () => {
	const restClient = createDirectus<TestSchema>('https://directus.example.com')
		.with(rest());

	test('every create and update command takes it', () => {
		assertType(
			restClient.request(
				createItems('collection_a', [{ id: 1 }], {
					mutationBatching: 'preserveMutationOrder',
				}),
			),
		);

		assertType(
			restClient.request(
				createItem('collection_a', { id: 1 }, {
					mutationBatching: 'disableBatching',
				}),
			),
		);

		assertType(
			restClient.request(
				updateItem('collection_a', 1, { string_field: 'kept' }, {
					mutationBatching: 'minimizeMutations',
				}),
			),
		);

		assertType(
			restClient.request(
				updateItems('collection_a', [1], { string_field: 'kept' }, {
					mutationBatching: 'disableBatching',
					onRepeatedPk: 'lastWins',
				}),
			),
		);

		assertType(
			restClient.request(
				updateItemsBatch('collection_a', [{ id: 1 }], {
					mutationBatching: 'preserveMutationOrder',
				}),
			),
		);
	});

	test('an unknown mode is refused', () => {
		assertType(
			restClient.request(
				createItems('collection_a', [{ id: 1 }], {
					fields: ['id'],
					// @ts-expect-error batchEverything is not a mutationBatching mode
					mutationBatching: 'batchEverything',
				}),
			),
		);
	});

	test('a system create and update take it', () => {
		assertType(
			restClient.request(
				createUsers([{ email: 'ada@example.com' }], {
					mutationBatching: 'preserveMutationOrder',
				}),
			),
		);

		assertType(
			restClient.request(
				updateSettings({ project_name: 'kept' }, {
					mutationBatching: 'disableBatching',
				}),
			),
		);
	});

	test('an unknown mode is refused on a system command', () => {
		assertType(
			restClient.request(
				createUsers([{ email: 'ada@example.com' }], {
					fields: ['id'],
					// @ts-expect-error batchEverything is not a mutationBatching mode
					mutationBatching: 'batchEverything',
				}),
			),
		);
	});
});
