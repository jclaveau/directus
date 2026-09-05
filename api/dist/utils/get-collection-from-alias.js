//#region src/utils/get-collection-from-alias.ts
/**
* Extract the collection of an alias within an aliasMap
* For example: 'ljnsv.name' -> 'authors'
*/
function getCollectionFromAlias(alias, aliasMap) {
	for (const aliasValue of Object.values(aliasMap)) if (aliasValue.alias === alias) return aliasValue.collection;
}

//#endregion
export { getCollectionFromAlias };