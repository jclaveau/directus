//#region src/scoped-cache/index-path.ts
/**
* The path a collection's cached reads are indexed by: the chain to the value
* they belong to, followed to the end.
*
* A scope field naming an M2O whose target scopes too is a hop, not a bound: the
* read pins the path THROUGH it, so `zone` leads to `zone.region` and on to
* `zone.region.owner`, the column the row finally belongs to. The deepest such
* path is the one that splits best — every slot of one region shares `zone`, and
* only the terminal tells one index value from another.
*
* The chain ends where the hops do: at a scope field naming no relation, or one
* whose target declares no scope of its own and is pinned by its key alone. Two
* chains of the same depth are settled by declaration order, so the field a
* collection names first is the one it is taken to belong to.
*/
function scopedCacheIndexPath(schema, collection) {
	const walkRelations = (current, prefix, visited) => {
		if (visited.has(current)) return null;
		const seenCollections = new Set(visited).add(current);
		let deepestPath = null;
		for (const field of schema.collections[current]?.scopedCacheFields ?? []) {
			if (field.includes(".")) continue;
			const relationPath = prefix === "" ? field : `${prefix}.${field}`;
			const targetRelation = schema.relations.find((relation) => {
				return relation.collection === current && relation.field === field;
			})?.related_collection;
			const candidatePath = (schema.collections[targetRelation ?? ""]?.scopedCacheFields ?? []).length > 0 && targetRelation ? walkRelations(targetRelation, relationPath, seenCollections) ?? relationPath : relationPath;
			if (deepestPath === null || candidatePath.split(".").length > deepestPath.split(".").length) deepestPath = candidatePath;
		}
		return deepestPath;
	};
	return walkRelations(collection, "", /* @__PURE__ */ new Set());
}
/**
* The fields a collection's reads off the index path are homed by, first match
* winning: the primary key, then its `scoped_cache_fields` in declared order.
*
* Read off the schema, never the read, so a fill and the write that has to find
* it rank the same way. The declared order is the admin's lever on the home.
*/
function scopedCacheHomePinFields(schema, collection) {
	const collectionOverview = schema.collections[collection];
	const primaryKeyField = collectionOverview?.primary;
	const scopeFields = (collectionOverview?.scopedCacheFields ?? []).filter((field) => field !== primaryKeyField);
	return primaryKeyField === void 0 ? scopeFields : [primaryKeyField, ...scopeFields];
}

//#endregion
export { scopedCacheHomePinFields, scopedCacheIndexPath };