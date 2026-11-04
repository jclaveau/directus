export type AliasGenerator = () => string;

/**
 * The join aliases of one SQL statement, subqueries included:
 * `alias_1`, `alias_2`, … never twice in that statement
 */
export function createAliasGenerator(): AliasGenerator {
	let aliasCount = 0;

	return () => `alias_${++aliasCount}`;
}
