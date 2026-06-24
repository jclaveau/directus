import { transaction } from "../transaction.js";
import { removeCircular } from "./remove-circular.js";
import { splitRecursive } from "./split-recursive.js";
import { useEnv } from "@directus/env";
import { ForbiddenError } from "@directus/errors";
import { deepMapWithSchema, getRelationInfo } from "@directus/utils";
import { cloneDeep, intersection, pick, uniq } from "lodash-es";
import { getNodeEnv } from "@directus/utils/node";

//#region src/utils/versioning/handle-version.ts
async function handleVersion(self, key, query, opts) {
	const { VersionsService } = await import("../../services/versions.js");
	const { ItemsService } = await import("../../services/items.js");
	if (key && query.versionRaw) {
		const version = query.version;
		delete query.version;
		delete query.versionRaw;
		const originalData = await self.readByQuery(query, opts);
		if (originalData.length === 0) throw new ForbiddenError();
		const versions$1 = await new VersionsService({
			schema: self.schema,
			accountability: self.accountability,
			knex: self.knex
		}).getVersionSaves(version, self.collection, key);
		return [Object.assign(originalData[0], versions$1?.[0]?.delta)];
	}
	const versions = await new VersionsService({
		schema: self.schema,
		accountability: self.accountability,
		knex: self.knex
	}).getVersionSaves(query.version, self.collection, key, false);
	if (key && versions.length === 0) throw new ForbiddenError();
	if (versions.length === 0) return [];
	let results = [];
	const createdIDs = {};
	const itemlessErrors = [];
	const itemMeta = {};
	const primaryKeyField = self.schema.collections[self.collection].primary;
	const hasPrimaryKeyInQuery = query.fields?.includes(primaryKeyField) || query.fields?.includes("*") || query.fields?.length === 0;
	await transaction(self.knex, async (trx) => {
		for (const version of versions) {
			const { id, item } = version;
			let delta = version.delta;
			if (!delta && item) {
				itemMeta[item] = {
					version_id: id,
					delta: {}
				};
				continue;
			}
			delta = delta ?? {};
			const { rawDelta, defaultOverwrites } = splitRecursive(delta);
			try {
				await transaction(trx, async (trxInner) => {
					const sudoItemsService = new ItemsService(self.collection, {
						schema: self.schema,
						knex: trxInner
					});
					if (!item) {
						const item$1 = await sudoItemsService.createOne(rawDelta, {
							emitEvents: false,
							autoPurgeCache: false,
							skipTracking: true,
							overwriteDefaults: defaultOverwrites,
							onItemCreate: (collection, pk) => {
								if (collection in createdIDs === false) createdIDs[collection] = [];
								createdIDs[collection].push(pk);
							}
						});
						itemMeta[item$1] = { version_id: id };
					} else {
						await sudoItemsService.updateOne(item, rawDelta, {
							emitEvents: false,
							autoPurgeCache: false,
							skipTracking: true,
							overwriteDefaults: defaultOverwrites,
							onItemCreate: (collection, pk) => {
								if (collection in createdIDs === false) createdIDs[collection] = [];
								createdIDs[collection].push(pk);
							}
						});
						itemMeta[item] = { version_id: id };
					}
				}, true);
			} catch (error) {
				if (key) throw error;
				sanitizeError(error);
				if (!item) itemlessErrors.push({
					error,
					version_id: id,
					delta
				});
				else itemMeta[item] = {
					error,
					version_id: id,
					delta
				};
			}
		}
		const itemsServiceUser = new ItemsService(self.collection, {
			schema: self.schema,
			accountability: self.accountability,
			knex: trx
		});
		query = cloneDeep(query);
		delete query.version;
		const ids = uniq([...createdIDs[self.collection] ?? [], ...versions.map((version) => version.item).filter(Boolean)]);
		query.filter = { _and: [...query.filter ? [query.filter] : [], { [primaryKeyField]: { _in: ids } }] };
		if (!hasPrimaryKeyInQuery) query.fields = [primaryKeyField, ...query.fields ?? []];
		results = await itemsServiceUser.readByQuery(query, { ...opts });
		await trx.rollback();
	});
	let requestedFields = Object.values(self.schema.collections[self.collection].fields).filter((field) => {
		return getRelationInfo(self.schema.relations, self.collection, field.field).relationType === null;
	}).map((field) => field.field);
	const queryFields = query.fields?.map((field) => field.split(".")[0]) ?? [];
	if (!queryFields?.includes("*")) requestedFields = intersection(requestedFields, queryFields);
	const defaultItem = Object.fromEntries(requestedFields.map((field) => [field, null]));
	results = results.map((result) => {
		const meta = itemMeta[result[primaryKeyField]];
		if (!hasPrimaryKeyInQuery) delete result[primaryKeyField];
		result = deepMapWithSchema(result, ([key$1, value], context) => {
			if (context.relationType === "m2o" || context.relationType === "a2o") {
				if (createdIDs[context.relation.related_collection]?.find((id) => String(id) === String(value))) return [key$1, null];
			} else if (context.relationType === "o2m" && Array.isArray(value)) {
				const ids = createdIDs[context.relation.collection];
				return [key$1, value.map((val) => {
					if (ids?.find((id) => String(id) === String(val))) return null;
					return val;
				})];
			}
			if (context.field.field === context.collection.primary) {
				if (createdIDs[context.collection.collection]?.find((id) => String(id) === String(value))) return [key$1, null];
			}
			return [key$1, value];
		}, {
			collection: self.collection,
			schema: self.schema
		});
		if (meta) {
			result["$meta"] = meta;
			if (meta.error) result = Object.assign({}, defaultItem, result, pick(meta.delta, requestedFields));
		}
		return result;
	});
	const env = useEnv();
	const effectiveLimit = query.limit ?? Number(env["QUERY_LIMIT_DEFAULT"]);
	if (effectiveLimit === -1 || results.length < effectiveLimit) results.push(...itemlessErrors.map((errorMeta) => {
		let item = { $meta: errorMeta };
		if (errorMeta.error) item = Object.assign({}, defaultItem, item, pick(errorMeta.delta, requestedFields));
		return item;
	}));
	return results;
}
function sanitizeError(error) {
	if (getNodeEnv() !== "development") delete error.stack;
	removeCircular(error);
}

//#endregion
export { handleVersion };