//#region src/database/run-ast/lib/apply-query/create-alias-generator.ts
/**
* The join aliases of one SQL statement, subqueries included:
* `__alias_1`, `__alias_2`, … never twice in that statement, the leading
* `__` keeping them off a collection named `alias_1`. A collection named
* `__alias_1` would still collide.
*/
function createAliasGenerator() {
	let aliasCount = 0;
	return () => `__alias_${++aliasCount}`;
}

//#endregion
export { createAliasGenerator };