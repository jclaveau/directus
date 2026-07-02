import database_default from "../../database/index.js";
import { readMeta, withMeta } from "../../utils/read-meta.js";
import { formatError } from "./errors/format.js";
import { GraphQLExecutionError } from "./errors/execution.js";
import { GraphQLValidationError } from "./errors/validation.js";
import "./errors/index.js";
import { generateSchema } from "./schema/index.js";
import { addPathToValidationError } from "./utils/add-path-to-validation-error.js";
import process_error_default from "./utils/process-error.js";
import { getService } from "../../utils/get-service.js";
import { useEnv } from "@directus/env";
import { NoSchemaIntrospectionCustomRule, execute, specifiedRules, validate } from "graphql";

//#region src/services/graphql/index.ts
const env = useEnv();
const validationRules = Array.from(specifiedRules);
if (env["GRAPHQL_INTROSPECTION"] === false) validationRules.push(NoSchemaIntrospectionCustomRule);
var GraphQLService = class {
	accountability;
	knex;
	schema;
	scope;
	/**
	* Union of cache tags across every read in this GraphQL request — a `/graphql` response is one
	* cached entry assembled from many reads, so this aggregate is by design (unlike a per-query read,
	* whose tags ride its result via `getMeta()`). Stamped onto the execute() result.
	*/
	scopedCacheTags;
	constructor(options) {
		this.accountability = options?.accountability || null;
		this.knex = options?.knex || database_default();
		this.schema = options.schema;
		this.scope = options.scope;
		this.scopedCacheTags = [];
	}
	/**
	* Execute a GraphQL structure
	*/
	async execute({ document, variables, operationName, contextValue }) {
		const schema = await this.getSchema();
		const validationErrors = validate(schema, document, validationRules).map((validationError) => addPathToValidationError(validationError));
		if (validationErrors.length > 0) throw new GraphQLValidationError({ errors: validationErrors });
		let result;
		try {
			result = await execute({
				schema,
				document,
				contextValue,
				variableValues: variables,
				operationName
			});
		} catch (err) {
			throw new GraphQLExecutionError({ errors: [err.message] });
		}
		const formattedResult = {};
		if (result["data"]) formattedResult.data = result["data"];
		if (result["errors"]) formattedResult.errors = result["errors"].map((error) => process_error_default(this.accountability, error));
		if (result["extensions"]) formattedResult.extensions = result["extensions"];
		return withMeta(formattedResult, { scopedCacheTags: this.scopedCacheTags });
	}
	async getSchema(type = "schema") {
		return generateSchema(this, type);
	}
	/**
	* Execute the read action on the correct service. Checks for singleton as well.
	*/
	async read(collection, query) {
		const service = getService(collection, {
			knex: this.knex,
			accountability: this.accountability,
			schema: this.schema
		});
		const result = this.schema.collections[collection].singleton ? await service.readSingleton(query, { stripNonRequested: false }) : await service.readByQuery(query, { stripNonRequested: false });
		this.scopedCacheTags.push(...readMeta(result)?.scopedCacheTags ?? []);
		return result;
	}
	/**
	* Upsert and read singleton item
	*/
	async upsertSingleton(collection, body, query) {
		const service = getService(collection, {
			knex: this.knex,
			accountability: this.accountability,
			schema: this.schema
		});
		try {
			await service.upsertSingleton(body);
			if ((query.fields || []).length > 0) return await service.readSingleton(query);
			return true;
		} catch (err) {
			throw formatError(err);
		}
	}
};

//#endregion
export { GraphQLService };