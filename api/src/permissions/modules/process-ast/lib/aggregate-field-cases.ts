import type { Filter, Permission } from '@directus/types';
import { isEqual } from '../../../../utils/lodash-es-used.js';
import { getCases } from './get-cases.js';

/**
 * The rules an aggregate of the field reads through a CASE, none when every row
 * read already grants the field.
 */
export function getAggregateFieldCases(
	collection: string,
	field: string,
	{ cases, permissions }: { cases: Filter[]; permissions: Permission[] },
): Filter[] {
	const {
		cases: ruleCases,
		caseMap,
		allowedFields,
	} = getCases(collection, permissions, []);

	if (allowedFields.has('*') || allowedFields.has(field)) {
		return [];
	}

	const fieldCases = [
		...(caseMap['*'] ?? []),
		...(caseMap[field] ?? []),
	].map((caseIndex) => ruleCases[caseIndex]!);

	// Every row read already goes through a rule granting the field
	if (cases.length > 0 && cases.every((rowCase) => {
		return fieldCases.some((fieldCase) => isEqual(fieldCase, rowCase));
	})) {
		return [];
	}

	return fieldCases;
}
