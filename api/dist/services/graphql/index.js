import { mergeScopedCacheEpochs } from "../../scoped-cache/fill-guard.js";
import database_default from "../../database/index.js";
import "../../scoped-cache/index.js";
import { readMeta, withMeta } from "../../utils/read-meta.js";
import { formatError } from "./errors/format.js";
import { GraphQLExecutionError } from "./errors/execution.js";
import { GraphQLValidationError } from "./errors/validation.js";
import "./errors/index.js";
import { executingService } from "./schema-cache.js";
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
	* Union of the cache fingerprints of every read in this GraphQL request — a
	* `/graphql` response is one cached entry assembled from many reads, so this
	* aggregate is by design (unlike a per-query read, whose fingerprints ride its
	* result via `getMeta()`). Stamped onto the execute() result.
	*
	* Each read's own AND survives the union: the entry dies when a write matches
	* any ONE of them whole, which is what "assembled from many reads" means.
	*/
	scopedCacheFingerprints;
	/**
	* Unautopurgeable scope fingerprints across every read in this request. Non-empty
	* → the whole `/graphql` entry can't be safely cached, so respond.ts skips it (and
	* names them in the anomaly). Aggregated like the fingerprints (one entry, many
	* reads).
	*/
	scopedCacheUnautopurgeableFingerprints;
	/**
	* The scoped cache purge counters this request's reads took before their
	* queries, merged across every root. A `/graphql` response is ONE cached entry
	* assembled from several reads, and `respond` compares these after the fill to
	* detect a purge that landed while they were running — so an entry the aggregate
	* never mentions is filled with no such check at all.
	*
	* The EARLIEST reading wins per collection: a root reading `E+1` where another
	* read `E` means a purge landed between them, and only the earlier value makes
	* the post-fill comparison notice. By reading, not by arrival — graphql-js
	* resolves root fields in parallel, so the first result back is not the first
	* counter taken.
	*/
	scopedCacheEpochs;
	/**
	* A root read returned no read meta: nothing records what it depends on, so no
	* write can purge the response by it. Filing the entry under the other roots'
	* fingerprints alone would outlive such a write, so it is filed under none —
	* which `respond` refuses in scoped mode, as it does a query hitting nothing.
	*/
	unpinnedRootRead;
	constructor(options) {
		this.accountability = options?.accountability || null;
		this.knex = options?.knex || database_default();
		this.schema = options.schema;
		this.scope = options.scope;
		this.scopedCacheFingerprints = [];
		this.scopedCacheUnautopurgeableFingerprints = [];
		this.scopedCacheEpochs = {};
		this.unpinnedRootRead = false;
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
			result = await executingService.run(this, () => {
				return execute({
					schema,
					document,
					contextValue,
					variableValues: variables,
					operationName
				});
			});
		} catch (err) {
			throw new GraphQLExecutionError({ errors: [err.message] });
		}
		const formattedResult = {};
		if (result["data"]) formattedResult.data = result["data"];
		if (result["errors"]) formattedResult.errors = result["errors"].map((error) => process_error_default(this.accountability, error));
		if (result["extensions"]) formattedResult.extensions = result["extensions"];
		return withMeta(formattedResult, {
			scopedCacheFingerprints: this.unpinnedRootRead ? [] : this.scopedCacheFingerprints,
			scopedCacheUnautopurgeableFingerprints: this.scopedCacheUnautopurgeableFingerprints,
			scopedCacheEpochs: this.scopedCacheEpochs
		});
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
		this.foldReadMeta(result);
		return result;
	}
	/**
	* Fold one root read's meta into this request's aggregate. The item roots go
	* through `read()`; the system roots (`users_me`, `fields`, …) call their
	* services directly and hand their result over here.
	*/
	foldReadMeta(readResult) {
		const resultMeta = readMeta(readResult);
		if (resultMeta === void 0) {
			this.unpinnedRootRead = true;
			return;
		}
		this.scopedCacheFingerprints.push(...resultMeta.scopedCacheFingerprints);
		this.scopedCacheUnautopurgeableFingerprints.push(...resultMeta.scopedCacheUnautopurgeableFingerprints ?? []);
		mergeScopedCacheEpochs(this.scopedCacheEpochs, resultMeta.scopedCacheEpochs ?? {});
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