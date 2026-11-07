import { useEnv } from '@directus/env';
import { afterEach, expect, test, vi } from 'vitest';
import { resolveMutationBatching } from './resolve-mutation-batching.js';

vi.mock('@directus/env');

afterEach(() => {
	vi.restoreAllMocks();
});

test('the caller value wins over DEFAULT_MUTATION_BATCHING', () => {
	vi.mocked(useEnv)
		.mockReturnValue({ DEFAULT_MUTATION_BATCHING: 'disableBatching' });

	expect(resolveMutationBatching({ mutationBatching: 'preserveMutationOrder' }))
		.toBe('preserveMutationOrder');
});

test('DEFAULT_MUTATION_BATCHING decides when the caller passes nothing', () => {
	vi.mocked(useEnv)
		.mockReturnValue({ DEFAULT_MUTATION_BATCHING: 'disableBatching' });

	expect(resolveMutationBatching({})).toBe('disableBatching');
});

test('an env without DEFAULT_MUTATION_BATCHING preserves the order', () => {
	vi.mocked(useEnv).mockReturnValue({});

	expect(resolveMutationBatching({})).toBe('preserveMutationOrder');
});

test('an unknown DEFAULT_MUTATION_BATCHING is refused', () => {
	vi.mocked(useEnv)
		.mockReturnValue({ DEFAULT_MUTATION_BATCHING: 'batchEverything' });

	expect(() => resolveMutationBatching({})).toThrowError(new Error(
		'"DEFAULT_MUTATION_BATCHING" must be one of minimizeMutations, '
		+ 'preserveMutationOrder, disableBatching, got "batchEverything"',
	));
});

test('an unknown mutationBatching is refused', () => {
	vi.mocked(useEnv)
		.mockReturnValue({ DEFAULT_MUTATION_BATCHING: 'minimizeMutations' });

	expect(() => {
		resolveMutationBatching({
			mutationBatching: 'batchEverything' as 'disableBatching',
		});
	}).toThrowError(new Error(
		'"mutationBatching" must be one of minimizeMutations, '
		+ 'preserveMutationOrder, disableBatching, got "batchEverything"',
	));
});

test('refuseChildJoiningSeveralRows is refused under disableBatching', () => {
	vi.mocked(useEnv)
		.mockReturnValue({ DEFAULT_MUTATION_BATCHING: 'disableBatching' });

	expect(() => {
		resolveMutationBatching({ refuseChildJoiningSeveralRows: true });
	}).toThrowError(new Error(
		'"refuseChildJoiningSeveralRows" cannot run under disableBatching '
		+ '(from "DEFAULT_MUTATION_BATCHING")',
	));
});

test('refuseChildJoiningSeveralRows runs under the other modes', () => {
	vi.mocked(useEnv)
		.mockReturnValue({ DEFAULT_MUTATION_BATCHING: 'disableBatching' });

	expect(resolveMutationBatching({
		mutationBatching: 'preserveMutationOrder',
		refuseChildJoiningSeveralRows: true,
	})).toBe('preserveMutationOrder');
});
