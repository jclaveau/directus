import { InvalidQueryError } from '@directus/errors';
import { NestedUpdateAnswers, type NestedUpdateAnswer } from '@directus/types';
import { oneLine } from '@directus/utils';
import type { Request } from 'express';

/**
 * The `nestedUpdates` query param, left unset when absent; read off the raw
 * query, since `sanitizeQuery` keeps only the read params.
 */
export function nestedUpdatesFromQuery(
	query: Request['query'],
): NestedUpdateAnswer | undefined {
	const nestedUpdates = query['nestedUpdates'];

	if (
		nestedUpdates !== undefined
		&& !NestedUpdateAnswers.includes(nestedUpdates as NestedUpdateAnswer)
	) {
		throw new InvalidQueryError({
			reason: oneLine`
				"nestedUpdates" must be one of ${NestedUpdateAnswers.join(', ')}
			`,
		});
	}

	return nestedUpdates as NestedUpdateAnswer | undefined;
}
