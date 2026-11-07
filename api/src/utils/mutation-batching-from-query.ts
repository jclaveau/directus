import { InvalidQueryError } from '@directus/errors';
import { MutationBatchingModes, type MutationBatchingMode } from '@directus/types';
import { oneLine } from '@directus/utils';
import type { Request } from 'express';

/**
 * The `mutationBatching` query param, left unset when absent; read off the
 * raw query, since `sanitizeQuery` keeps only the read params.
 */
export function mutationBatchingFromQuery(
	query: Request['query'],
): MutationBatchingMode | undefined {
	const mutationBatching = query['mutationBatching'];

	if (
		mutationBatching !== undefined
		&& !MutationBatchingModes.includes(mutationBatching as MutationBatchingMode)
	) {
		throw new InvalidQueryError({
			reason: oneLine`
				"mutationBatching" must be one of ${MutationBatchingModes.join(', ')}
			`,
		});
	}

	return mutationBatching as MutationBatchingMode | undefined;
}
