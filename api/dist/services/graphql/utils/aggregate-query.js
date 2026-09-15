import { sanitizeQuery } from "../../../utils/sanitize-query.js";
import { validateQuery } from "../../../utils/validate-query.js";
import { replaceFuncs } from "./replace-funcs.js";

//#region src/services/graphql/utils/aggregate-query.ts
/**
* Resolve the aggregation query based on the requested aggregated fields
*/
async function getAggregateQuery(rawQuery, selections, schema, accountability) {
	const query = await sanitizeQuery(rawQuery, schema, accountability);
	query.aggregate = {};
	for (let aggregationGroup of selections) {
		if (aggregationGroup.kind === "Field" !== true) continue;
		aggregationGroup = aggregationGroup;
		if (aggregationGroup.name.value.startsWith("__")) continue;
		const aggregateProperty = aggregationGroup.name.value;
		query.aggregate[aggregateProperty] = aggregationGroup.selectionSet?.selections.filter((selectionNode) => !selectionNode?.name.value.startsWith("__")).map((selectionNode) => {
			selectionNode = selectionNode;
			return selectionNode.name.value;
		}) ?? [];
	}
	if (query.filter) query.filter = replaceFuncs(query.filter);
	validateQuery(query);
	return query;
}

//#endregion
export { getAggregateQuery };