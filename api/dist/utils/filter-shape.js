//#region src/utils/filter-shape.ts
/**
* The two questions every walk over a Directus filter has to answer about a
* node before it can decide anything else — kept here because the expansion and
* the scoped-cache keying analysis must read a filter the same way. Answering
* them apart is how the shape one rewrites drifts from the shape the other
* follows: a quantifier added to one list and not the other would leave the
* analysis reading a node the expansion never produced.
*/
/**
* Whether a value is a nested filter node rather than a leaf the caller has to
* read as a value — `{ _eq: 7 }` and `{ id: … }` are nodes, `7` and `[7, 8]`
* are not.
*/
function isFilterNode(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
/**
* Whether the conditions under a relational key name a further field, or a
* nested grouping, rather than applying to the key itself — so the path carries
* on across the relation instead of ending on this alias.
*/
function hopsAcrossRelation(conditions) {
	return Object.keys(conditions).some((key) => {
		return key.startsWith("_") === false || [
			"_and",
			"_or",
			"_some",
			"_none"
		].includes(key);
	});
}

//#endregion
export { hopsAcrossRelation, isFilterNode };