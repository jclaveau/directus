import type { Filter } from '@directus/types';
import { isObject } from '@directus/utils/values';
import { flattenFilter } from '../../../../permissions/modules/process-ast/utils/flatten-filter.js';

/**
 * Returns null or the operation information form a FieldFilter
 */
export function getOperation(key: string, value: unknown): { operator: string; value: unknown } | null {
	if (key === '_and' || key === '_or') return null;

	if (key.startsWith('_') && key !== '_none' && key !== '_some') {
		return { operator: key, value };
	} else if (!isObject(value)) {
		return { operator: '_eq', value };
	}

	const childKey = Object.keys(value)[0];

	if (childKey) {
		const childOperation = getOperation(childKey, Object.values(value)[0]);

		// An _and/_or under a quantifier has no single operation, but its
		// subquery applies it whole: returning null would drop the clause.
		// Content reading no field stays null: no permission check or cache
		// pin sees that relation, so it must not read it
		if (
			!childOperation
			&& (key === '_none' || key === '_some')
			&& readsField(value as Filter)
		) {
			return { operator: key, value };
		}

		return childOperation;
	}

	return null;
}

function readsField(filter: Filter) {
	const fieldPaths: string[][] = [];

	flattenFilter(fieldPaths, filter);

	return fieldPaths.length > 0;
}
