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
 * `MutationBatchingModes` is refused, never read as the default. So is
 * `refuseChildJoiningSeveralRows` under `disableBatching`: each row is written
 * on its own there, so no row could see another one's children.
 */
export function resolveMutationBatching(
	opts: Pick<
		MutationOptions,
		'mutationBatching' | 'refuseChildJoiningSeveralRows'
	>,
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

	if (
		mutationBatching === 'disableBatching'
		&& opts.refuseChildJoiningSeveralRows
	) {
		throw new Error(oneLine`
			"refuseChildJoiningSeveralRows" cannot run under disableBatching
			(from "${source}")
		`);
	}

	return mutationBatching as MutationBatchingMode;
}
