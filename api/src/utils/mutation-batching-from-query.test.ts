import { InvalidQueryError } from '@directus/errors';
import { expect, test } from 'vitest';
import { mutationBatchingFromQuery } from './mutation-batching-from-query.js';

test('an absent mutationBatching is left unset', () => {
	expect(mutationBatchingFromQuery({})).toBe(undefined);
});

test('a known mutationBatching is returned as is', () => {
	expect(mutationBatchingFromQuery({ mutationBatching: 'disableBatching' }))
		.toBe('disableBatching');
});

test('an unknown mutationBatching is refused', () => {
	expect(() => mutationBatchingFromQuery({ mutationBatching: 'batchEverything' }))
		.toThrowError(new InvalidQueryError({
			reason: '"mutationBatching" must be one of minimizeMutations, '
				+ 'preserveMutationOrder, disableBatching',
		}));
});

test('a repeated mutationBatching is refused', () => {
	expect(() => {
		mutationBatchingFromQuery({
			mutationBatching: ['disableBatching', 'minimizeMutations'],
		});
	}).toThrowError(new InvalidQueryError({
		reason: '"mutationBatching" must be one of minimizeMutations, '
			+ 'preserveMutationOrder, disableBatching',
	}));
});
