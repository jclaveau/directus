import type { Filter } from '@directus/types';
import { isObject } from '@directus/utils/values';
import {
	flattenFilter,
} from '../../../../permissions/modules/process-ast/utils/flatten-filter.js';

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

		if (!childOperation && (key === '_none' || key === '_some')) {
			const fieldPaths: string[][] = [];

			flattenFilter(fieldPaths, value as Filter);

			// An _and/_or has no single operation, but the subquery applies it
			// whole: null would drop the clause. Content reading no field stays
			// null: no permission check or cache pin sees that relation
			if (fieldPaths.length > 0) {
				return { operator: key, value };
			}
		}

		return childOperation;
	}

	return null;
}
