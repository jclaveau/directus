import type { Filter } from '@directus/types';

/**
 * Client-side evaluation of a Directus filter against a plain row, so the cache
 * page's field-filter (built from the descriptor collection) can narrow the
 * already-loaded list without a round-trip. `fieldMap` translates collection
 * field names to the row's own keys; unknown operators pass (never exclude).
 */
export function matchesFilter(
	entry: Record<string, unknown>,
	filter: Filter | null,
	fieldMap: Record<string, string> = {},
): boolean {
	if (!filter || typeof filter !== 'object') {
		return true;
	}

	return Object.entries(filter).every(([key, condition]) => {
		if (key === '_and') {
			return (condition as Filter[]).every((sub) => {
				return matchesFilter(entry, sub, fieldMap);
			});
		}

		if (key === '_or') {
			return (condition as Filter[]).some((sub) => {
				return matchesFilter(entry, sub, fieldMap);
			});
		}

		const field = fieldMap[key] ?? key;
		return matchesCondition(entry[field], condition);
	});
}

function matchesCondition(value: unknown, condition: unknown): boolean {
	if (condition === null || typeof condition !== 'object') {
		return value === condition;
	}

	const entries = Object.entries(condition as Record<string, unknown>);

	return entries.every(([op, operand]) => {
		const text = String(value ?? '').toLowerCase();
		const needle = String(operand ?? '').toLowerCase();

		switch (op) {
			case '_eq':
				return value === operand;
			case '_neq':
				return value !== operand;
			case '_contains':
			case '_icontains':
				return text.includes(needle);
			case '_ncontains':
				return !text.includes(needle);
			case '_starts_with':
				return text.startsWith(needle);
			case '_ends_with':
				return text.endsWith(needle);
			case '_gt':
				return Number(value) > Number(operand);
			case '_gte':
				return Number(value) >= Number(operand);
			case '_lt':
				return Number(value) < Number(operand);
			case '_lte':
				return Number(value) <= Number(operand);
			case '_in':
				return Array.isArray(operand) && operand.includes(value);
			case '_nin':
				return Array.isArray(operand) && !operand.includes(value);
			case '_null':
				return operand
					? value == null
					: value != null;
			case '_nnull':
				return operand
					? value != null
					: value == null;
			case '_empty':
				return operand
					? !value
					: Boolean(value);
			case '_nempty':
				return operand
					? Boolean(value)
					: !value;
			default:
				return true;
		}
	});
}
