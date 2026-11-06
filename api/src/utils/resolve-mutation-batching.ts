import { useEnv } from '@directus/env';
import {
	MutationBatchingModes,
	type MutationBatchingMode,
	type MutationOptions,
} from '@directus/types';
import { oneLine } from '@directus/utils';

/**
 * The batching a write runs with: the caller's `mutationBatching`, else
 * `DEFAULT_MUTATION_BATCHING`, else `minimizeMutations` (an env missing the
 * var, which `useEnv`'s defaults never leave out). A value outside
 * `MutationBatchingModes` is refused, never read as the default.
 */
export function resolveMutationBatching(
	opts: Pick<MutationOptions, 'mutationBatching'>,
): MutationBatchingMode {
	const source = opts.mutationBatching === undefined
		? 'DEFAULT_MUTATION_BATCHING'
		: 'mutationBatching';

	const mutationBatching = opts.mutationBatching
		?? useEnv()['DEFAULT_MUTATION_BATCHING']
		?? 'minimizeMutations';

	if (!MutationBatchingModes.includes(mutationBatching as MutationBatchingMode)) {
		throw new Error(oneLine`
			"${source}" must be one of ${MutationBatchingModes.join(', ')},
			got ${JSON.stringify(mutationBatching)}
		`);
	}

	return mutationBatching as MutationBatchingMode;
}
