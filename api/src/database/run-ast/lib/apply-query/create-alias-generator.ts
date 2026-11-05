export type AliasGenerator = () => string;

/**
 * The join aliases of one SQL statement, subqueries included:
 * `__alias_1`, `__alias_2`, … never twice in that statement, the leading
 * `__` keeping them off a collection named `alias_1`
 */
export function createAliasGenerator(): AliasGenerator {
	let aliasCount = 0;

	return () => `__alias_${++aliasCount}`;
}
