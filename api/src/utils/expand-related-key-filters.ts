import type { Filter, SchemaOverview } from '@directus/types';
import { getRelationInfo } from './get-relation-info.js';
import { parseFilterKey } from './parse-filter-key.js';

function isFilterNode(value: unknown): boolean {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Rewrite a filter into the one shape the SQL builder ends up reading, so a
 * consumer that has to reason about which rows a filter reaches does not have to
 * re-derive it.
 *
 * Two spellings collapse:
 *
 * - A leaf carrying no operator becomes `_eq`, which is how `getOperation` reads
 *   it: `{ id: 7 }` and `{ id: { _eq: 7 } }` compile identically.
 * - An operator sitting directly on a to-many alias becomes an operator on the
 *   RELATED primary key, which is what `getColumnPath` does when a path ends on an
 *   alias field (`addNestedPkField`): `{ items: { _eq: 7 } }` reads
 *   `{ items: { id: { _eq: 7 } } }`, and both join the related table.
 *
 * The M2O direction is deliberately left alone. There the foreign key is a column
 * of THIS collection, so `{ owner: { _eq: 7 } }` compiles to `owner = ?` with no
 * join and reads no row of the related collection — expanding it would invent a
 * dependency that the query does not have.
 *
 * Structural only: no condition is added, removed or reordered, and the result is
 * a new object — the caller's filter is never mutated. It is NOT written back onto
 * the AST, because the field map drives permission validation and would then start
 * naming collections the shorthand does not name today.
 */
export function expandRelatedKeyFilters(
	schema: SchemaOverview,
	collection: string,
	filter: Filter,
): Filter {
	const expanded: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(filter)) {
		if ((key === '_and' || key === '_or') && Array.isArray(value)) {
			expanded[key] = value.map((branch) => {
				return expandRelatedKeyFilters(schema, collection, branch as Filter);
			});

			continue;
		}

		// A quantifier does not cross a relation of its own: the caller already did.
		if ((key === '_some' || key === '_none') && isFilterNode(value)) {
			expanded[key] = expandRelatedKeyFilters(schema, collection, value as Filter);
			continue;
		}

		if (key.startsWith('_')) {
			expanded[key] = value;
			continue;
		}

		const conditions = isFilterNode(value)
			? value as Record<string, unknown>
			: { _eq: value };

		const [pathField, pathScope] = key.split(':') as [string, string?];
		const { fieldName, functionName } = parseFilterKey(pathField);

		const { relation, relationType } = getRelationInfo(
			schema.relations,
			collection,
			fieldName,
		);

		if (!relation) {
			expanded[key] = conditions;
			continue;
		}

		const relatedCollection = pathScope ?? (
			relationType === 'o2m'
				? relation.collection
				: relation.related_collection
		);

		if (!relatedCollection) {
			expanded[key] = conditions;
			continue;
		}

		// A further field, or a nested grouping, means the path carries on rather
		// than ending on this alias — so there is no related key to append.
		const carriesOn = Object.keys(conditions).some((child) => {
			return (
				child.startsWith('_') === false ||
				['_and', '_or', '_some', '_none'].includes(child)
			);
		});

		if (carriesOn) {
			expanded[key] = expandRelatedKeyFilters(
				schema,
				relatedCollection,
				conditions as Filter,
			);

			continue;
		}

		const relatedPrimaryKey = schema.collections[relatedCollection]?.primary;

		// A function key reads the related rows through a transform rather than
		// naming one: `count(items)` compares a total, and moving that total onto
		// the related key would read it as an id the filter never named.
		if (
			functionName !== undefined ||
			relationType !== 'o2m' ||
			relatedPrimaryKey === undefined
		) {
			expanded[key] = conditions;
			continue;
		}

		expanded[key] = { [relatedPrimaryKey]: conditions };
	}

	return expanded as Filter;
}
