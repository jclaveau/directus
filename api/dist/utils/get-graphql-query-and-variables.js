import { pick } from "lodash-es";

//#region src/utils/get-graphql-query-and-variables.ts
function getGraphqlQueryAndVariables(req) {
	return pick(req.method?.toLowerCase() === "get" ? req.query : req.body, ["query", "variables"]);
}

//#endregion
export { getGraphqlQueryAndVariables };