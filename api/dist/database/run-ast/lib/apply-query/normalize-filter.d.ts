import type { Filter } from '@directus/types';
/**
 * Normalizes a filter so that each relational path segment has at most one
 * non-operator child key. When a relational object has multiple sibling
 * children (e.g. `{ parent: { field_a: { _eq: 'value' }, nested: { ... } } }`),
 * they are split into separate entries wrapped in `_and`.
 *
 * This is necessary because `getFilterPath` only follows `Object.keys(value)[0]`,
 * silently dropping any sibling keys at the same nesting level.
 */
export declare function normalizeFilter(filter: Filter): Filter;
