import database_default from "../../database/index.js";
import { getService } from "../../utils/get-service.js";
import { formatError } from "./errors/format.js";
import { GraphQLExecutionError } from "./errors/execution.js";
import { GraphQLValidationError } from "./errors/validation.js";
import "./errors/index.js";
import { generateSchema } from "./schema/index.js";
import { addPathToValidationError } from "./utils/add-path-to-validation-error.js";
import process_error_default from "./utils/process-error.js";
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
	constructor(options) {
		this.accountability = options?.accountability || null;
		this.knex = options?.knex || database_default();
		this.schema = options.schema;
		this.scope = options.scope;
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
		return formattedResult;
	}
	async getSchema(type = "schema") {
		return generateSchema(this, type);
	}
	/**
	* Execute the read action on the correct service. Checks for singleton as well.
	*/
	async read(collection, query, id) {
		const service = getService(collection, {
			knex: this.knex,
			accountability: this.accountability,
			schema: this.schema
		});
		if (this.schema.collections[collection].singleton) return await service.readSingleton(query, { stripNonRequested: false });
		if (id) return await service.readOne(id, query, { stripNonRequested: false });
		return await service.readByQuery(query, { stripNonRequested: false });
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