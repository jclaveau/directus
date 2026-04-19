import { parseArgs } from "../schema/parse-args.js";
import { getQuery } from "../schema/parse-query.js";
import { replaceFragmentsInSelections } from "../utils/replace-fragments.js";
import { mergeVersionsRaw, mergeVersionsRecursive } from "../../../utils/merge-version-data.js";
import { VersionsService } from "../../versions.js";
import { getAggregateQuery } from "../utils/aggregate-query.js";
import { omit } from "lodash-es";
import { parseFilterFunctionPath } from "@directus/utils";

//#region src/services/graphql/resolvers/query.ts
/**
* Generic resolver that's used for every "regular" items/system query. Converts the incoming GraphQL AST / fragments into
* Directus' query structure which is then executed by the services.
*/
async function resolveQuery(gql, info) {
	let collection = info.fieldName;
	if (gql.scope === "system") collection = `directus_${collection}`;
	const selections = replaceFragmentsInSelections(info.fieldNodes[0]?.selectionSet?.selections, info.fragments);
	if (!selections) return null;
	const args = parseArgs(info.fieldNodes[0].arguments || [], info.variableValues);
	let query;
	let versionRaw = false;
	if (collection.endsWith("_aggregated") && collection in gql.schema.collections === false) {
		query = await getAggregateQuery(args, selections, gql.schema, gql.accountability);
		collection = collection.slice(0, -11);
	} else {
		query = await getQuery(args, gql.schema, selections, info.variableValues, gql.accountability, collection);
		if (collection.endsWith("_by_id") && collection in gql.schema.collections === false) collection = collection.slice(0, -6);
		if (collection.endsWith("_by_version") && collection in gql.schema.collections === false) {
			collection = collection.slice(0, -11);
			versionRaw = true;
		}
	}
	if (args["id"]) {
		query.filter = { _and: [query.filter || {}, { [gql.schema.collections[collection].primary]: { _eq: args["id"] } }] };
		query.limit = 1;
	}
	if (query.fields?.length) for (let fieldIndex = 0; fieldIndex < query.fields.length; fieldIndex++) query.fields[fieldIndex] = parseFilterFunctionPath(query.fields[fieldIndex]);
	const result = await gql.read(collection, query);
	if (args["version"]) {
		const saves = await new VersionsService({
			accountability: gql.accountability,
			schema: gql.schema
		}).getVersionSaves(args["version"], collection, args["id"]);
		if (saves) if (gql.schema.collections[collection].singleton) return versionRaw ? mergeVersionsRaw(result, saves) : mergeVersionsRecursive(result, saves, collection, gql.schema);
		else {
			if (result?.[0] === void 0) return null;
			return versionRaw ? mergeVersionsRaw(result[0], saves) : mergeVersionsRecursive(result[0], saves, collection, gql.schema);
		}
	}
	if (args["id"]) return result?.[0] || null;
	if (query.group) {
		const aggregateKeys = Object.keys(query.aggregate ?? {});
		result["map"]((field) => {
			field["group"] = omit(field, aggregateKeys);
		});
	}
	return result;
}

//#endregion
export { resolveQuery };