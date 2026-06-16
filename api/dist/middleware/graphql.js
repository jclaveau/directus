import async_handler_default from "../utils/async-handler.js";
import { GraphQLValidationError } from "../services/graphql/errors/validation.js";
import { useEnv } from "@directus/env";
import { InvalidPayloadError, InvalidQueryError, MethodNotAllowedError } from "@directus/errors";
import { parseJSON } from "@directus/utils";
import { Source, getOperationAST, parse } from "graphql";

//#region src/middleware/graphql.ts
const parseGraphQL = async_handler_default(async (req, res, next) => {
	if (req.method !== "GET" && req.method !== "POST") throw new MethodNotAllowedError({
		allowed: ["GET", "POST"],
		current: req.method
	});
	let query = null;
	let variables = null;
	let operationName = null;
	let document;
	if (req.method === "GET") {
		query = req.query["query"] || null;
		if (req.query["variables"]) try {
			variables = parseJSON(req.query["variables"]);
		} catch {
			throw new InvalidQueryError({ reason: `Variables are invalid JSON` });
		}
		else variables = {};
		operationName = req.query["operationName"] || null;
	} else {
		query = req.body.query || null;
		variables = req.body.variables || null;
		operationName = req.body.operationName || null;
	}
	if (query === null) throw new InvalidPayloadError({ reason: "Must provide query string" });
	try {
		const env = useEnv();
		document = parse(new Source(query), { maxTokens: Number(env["GRAPHQL_QUERY_TOKEN_LIMIT"]) });
	} catch (err) {
		throw new GraphQLValidationError({ errors: [err] });
	}
	const operationAST = getOperationAST(document, operationName);
	if (req.method === "GET" && operationAST?.operation !== "query") throw new MethodNotAllowedError({
		allowed: ["POST"],
		current: "GET"
	});
	if (operationAST?.operation === "mutation") res.locals["cache"] = false;
	res.locals["graphqlParams"] = {
		document,
		query,
		variables,
		operationName,
		contextValue: {
			req,
			res,
			cache: /* @__PURE__ */ new Map()
		}
	};
	return next();
});

//#endregion
export { parseGraphQL };