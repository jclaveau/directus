import "../packages/types/dist/index.js";
import { getCache } from "../cache.js";
import { getHelpers } from "../database/helpers/index.js";
import emitter_default from "../emitter.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { PayloadService } from "./payload.js";
import { shouldClearCache } from "../utils/should-clear-cache.js";
import { splitRecursive } from "../utils/versioning/split-recursive.js";
import { ItemsService } from "./items.js";
import { ActivityService } from "./activity.js";
import { RevisionsService } from "./revisions.js";
import { ForbiddenError, InvalidPayloadError, UnprocessableContentError, VersionHashMismatchError } from "@directus/errors";
import { deepMapWithSchema } from "@directus/utils";
import { assign, get, isEqual, isNil, isPlainObject, pick } from "lodash-es";
import { Action, VERSION_KEY_DRAFT, isPublishedVersionKey } from "@directus/constants";
import hash from "object-hash";
import Joi from "joi";

//#region src/services/versions.ts
var VersionsService = class VersionsService extends ItemsService {
	constructor(options) {
		super("directus_versions", options);
	}
	async validateCreateData(data) {
		const versionCreateSchema = Joi.object({
			key: Joi.string().required(),
			name: Joi.string().allow(null),
			collection: Joi.string().required(),
			item: Joi.string().allow(null)
		});
		const itemLess = isNil(data["item"]);
		const { error } = versionCreateSchema.validate(data);
		if (error) throw new InvalidPayloadError({ reason: error.message });
		if (isPublishedVersionKey(data["key"])) throw new InvalidPayloadError({ reason: `"${data["key"]}" is a reserved version key` });
		if (itemLess && data["key"] !== VERSION_KEY_DRAFT) throw new InvalidPayloadError({ reason: `"key" must be "${VERSION_KEY_DRAFT}" for versions not linked to an item` });
		if (this.accountability) try {
			await validateAccess(itemLess ? {
				accountability: this.accountability,
				action: "read",
				collection: data["collection"]
			} : {
				accountability: this.accountability,
				action: "read",
				collection: data["collection"],
				primaryKeys: [data["item"]]
			}, {
				schema: this.schema,
				knex: this.knex
			});
		} catch {
			throw new ForbiddenError();
		}
		const { CollectionsService } = await import("./collections.js");
		if (!(await new CollectionsService({
			knex: this.knex,
			schema: this.schema
		}).readOne(data["collection"])).meta?.versioning) throw new UnprocessableContentError({ reason: `Content Versioning is not enabled for collection "${data["collection"]}"` });
		const isSingleton = !!this.schema.collections[data["collection"]]?.singleton;
		if (itemLess) if (isSingleton) await this.assertSingletonEmpty(data["collection"]);
		else return;
		if ((await new VersionsService({
			knex: this.knex,
			schema: this.schema
		}).readByQuery({
			aggregate: { count: ["*"] },
			filter: {
				key: { _eq: data["key"] },
				collection: { _eq: data["collection"] },
				item: itemLess ? { _null: true } : { _eq: data["item"] }
			}
		}))[0]["count"] > 0) throw new UnprocessableContentError({ reason: itemLess ? `Singleton collection "${data["collection"]}" already has an item-less version` : `Version "${data["key"]}" already exists for item "${data["item"]}" in collection "${data["collection"]}"` });
	}
	async getMainItem(collection, item, query) {
		return await new ItemsService(collection, {
			knex: this.knex,
			accountability: this.accountability,
			schema: this.schema
		}).readOne(item, query);
	}
	async verifyHash(collection, item, hash$1) {
		const mainHash = hash(await this.getMainItem(collection, item));
		return {
			outdated: hash$1 !== mainHash,
			mainHash
		};
	}
	async getVersionSaves(key, collection, item, mapDelta = true) {
		let itemFilter = {};
		if (item) itemFilter = { item: { _eq: item } };
		let versions = await this.readByQuery({
			filter: {
				key: { _eq: key },
				collection: { _eq: collection },
				...itemFilter
			},
			limit: -1
		});
		if (mapDelta) versions = versions.map((version) => {
			if (version.delta) version.delta = this.mapDelta(version);
			return version;
		});
		return versions;
	}
	async createOne(data, opts) {
		await this.validateCreateData(data);
		if (data["item"]) data["hash"] = hash(await this.getMainItem(data["collection"], data["item"]));
		else data["hash"] = null;
		return super.createOne(data, opts);
	}
	async readOne(key, query = {}, opts) {
		const version = await super.readOne(key, query, opts);
		if (version?.delta) version.delta = this.mapDelta(version);
		return version;
	}
	async createMany(data, opts) {
		if (!Array.isArray(data)) throw new InvalidPayloadError({ reason: "Input should be an array of items" });
		const keyCombos = /* @__PURE__ */ new Set();
		for (const item of data) {
			if (isNil(item["item"])) continue;
			const keyCombo = `${item["key"]}-${item["collection"]}-${item["item"]}`;
			if (keyCombos.has(keyCombo)) throw new UnprocessableContentError({ reason: `Cannot create multiple versions on "${item["item"]}" in collection "${item["collection"]}" with the same key "${item["key"]}"` });
			keyCombos.add(keyCombo);
		}
		return super.createMany(data, opts);
	}
	async updateMany(keys, data, opts) {
		const { error } = Joi.object({
			key: Joi.string(),
			name: Joi.string().allow(null),
			item: Joi.string().allow(null)
		}).validate(data);
		if (error) throw new InvalidPayloadError({ reason: error.message });
		if (isPublishedVersionKey(data["key"])) throw new InvalidPayloadError({ reason: `"${data["key"]}" is a reserved version key` });
		const keyCombos = /* @__PURE__ */ new Set();
		for (const pk of keys) {
			const existingVersion = await this.readOne(pk, { fields: [
				"collection",
				"item",
				"key"
			] });
			const collection = existingVersion.collection;
			const item = "item" in data ? data["item"] : existingVersion.item;
			const key = "key" in data ? data["key"] : existingVersion.key;
			if (key !== VERSION_KEY_DRAFT && item === null) throw new InvalidPayloadError({ reason: `"key" must be "${VERSION_KEY_DRAFT}" for versions not linked to an item` });
			if (item === null) {
				if (this.schema.collections[collection]?.singleton) {
					await this.assertSingletonEmpty(collection);
					if ((await super.readByQuery({
						aggregate: { count: ["*"] },
						filter: {
							id: { _neq: pk },
							collection: { _eq: collection },
							item: { _null: true }
						}
					}))[0]["count"] > 0) throw new UnprocessableContentError({ reason: `Singleton collection "${collection}" already has an item-less version` });
				}
				continue;
			}
			const keyCombo = `${key}-${collection}-${item}`;
			if (keyCombos.has(keyCombo)) throw new UnprocessableContentError({ reason: `Cannot update multiple versions on "${item}" in collection "${collection}" to the same key "${key}"` });
			keyCombos.add(keyCombo);
			if ((await super.readByQuery({
				aggregate: { count: ["*"] },
				filter: {
					id: { _neq: pk },
					key: { _eq: key },
					collection: { _eq: collection },
					item: { _eq: item }
				}
			}))[0]["count"] > 0) throw new UnprocessableContentError({ reason: `Version "${key}" already exists for item "${item}" in collection "${collection}"` });
		}
		return super.updateMany(keys, data, opts);
	}
	async save(key, delta, opts) {
		const version = await super.readOne(key);
		const payloadService = new PayloadService(this.collection, {
			accountability: this.accountability,
			knex: this.knex,
			schema: this.schema
		});
		const { item, collection, delta: existingDelta } = version;
		let revisionDelta = await payloadService.prepareDelta(delta);
		if (item) {
			const trackingAccountability = this.schema.collections[collection]?.accountability ?? null;
			if (trackingAccountability !== null) {
				const revisionsService = new RevisionsService({
					knex: this.knex,
					schema: this.schema
				});
				let patchedExistingRevision = false;
				if (opts?.patchRevision && trackingAccountability === "all") {
					const [latestRevision] = await revisionsService.readByQuery({
						filter: { version: { _eq: key } },
						sort: ["-activity.timestamp"],
						limit: 1,
						fields: [
							"id",
							"data",
							"delta",
							"activity.user"
						]
					});
					const currentUser = this.accountability?.user ?? null;
					const latestRevisionUser = (latestRevision?.["activity"])?.user ?? null;
					if (latestRevision && latestRevisionUser === currentUser) {
						const mergedRevisionData = assign({}, latestRevision["data"], revisionDelta);
						const mergedRevisionDelta = assign({}, latestRevision["delta"], revisionDelta);
						await revisionsService.updateOne(latestRevision["id"], {
							data: mergedRevisionData,
							delta: mergedRevisionDelta
						});
						patchedExistingRevision = true;
					}
				}
				if (!patchedExistingRevision) {
					const activity = await new ActivityService({
						knex: this.knex,
						schema: this.schema
					}).createOne({
						action: Action.VERSION_SAVE,
						user: this.accountability?.user ?? null,
						collection,
						ip: this.accountability?.ip ?? null,
						user_agent: this.accountability?.userAgent ?? null,
						origin: this.accountability?.origin ?? null,
						item
					});
					if (trackingAccountability === "all") await revisionsService.createOne({
						activity,
						version: key,
						collection,
						item,
						data: revisionDelta,
						delta: revisionDelta
					});
				}
			}
		}
		revisionDelta = revisionDelta ? revisionDelta : null;
		const helpers = getHelpers(this.knex);
		const date = new Date(helpers.date.writeTimestamp((/* @__PURE__ */ new Date()).toISOString()));
		deepMapObjects(revisionDelta, (object, path) => {
			const existing = get(existingDelta, path);
			if (existing && isEqual(existing, object)) return;
			object["_user"] = this.accountability?.user;
			object["_date"] = date;
		});
		const finalVersionDelta = assign({}, existingDelta, revisionDelta);
		await new ItemsService(this.collection, {
			knex: this.knex,
			schema: this.schema,
			accountability: {
				...this.accountability,
				admin: true
			}
		}).updateOne(key, { delta: finalVersionDelta });
		const { cache } = getCache();
		if (shouldClearCache(cache, void 0, collection)) cache.clear();
		return finalVersionDelta;
	}
	async promote(version, opts) {
		const { collection, item, delta } = await super.readOne(version);
		if (item && typeof opts?.mainHash !== "string") throw new InvalidPayloadError({ reason: `"mainHash" field is required` });
		if (this.accountability) await validateAccess(item ? {
			accountability: this.accountability,
			action: "update",
			collection,
			primaryKeys: [item]
		} : {
			accountability: this.accountability,
			action: "create",
			collection
		}, {
			schema: this.schema,
			knex: this.knex
		});
		if (!delta) throw new UnprocessableContentError({ reason: `No changes to promote` });
		if (item) {
			const { outdated, mainHash } = await this.verifyHash(collection, item, opts?.mainHash);
			if (outdated) throw new VersionHashMismatchError({ mainHash });
		}
		const { rawDelta, defaultOverwrites } = splitRecursive(delta);
		const payloadToUpdate = opts?.fields ? pick(rawDelta, opts.fields) : rawDelta;
		const itemsService = new ItemsService(collection, {
			accountability: this.accountability,
			knex: this.knex,
			schema: this.schema
		});
		const payloadAfterHooks = await emitter_default.emitFilter(["items.promote", `${collection}.items.promote`], payloadToUpdate, {
			collection,
			item,
			version
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		});
		let updatedItemKey;
		if (item) updatedItemKey = await itemsService.updateOne(item, payloadAfterHooks, { overwriteDefaults: defaultOverwrites });
		else {
			await this.assertSingletonEmpty(collection);
			updatedItemKey = await itemsService.createOne(payloadAfterHooks, { overwriteDefaults: defaultOverwrites });
			await this.updateOne(version, { item: String(updatedItemKey) });
		}
		emitter_default.emitAction(["items.promote", `${collection}.items.promote`], {
			payload: payloadAfterHooks,
			collection,
			item: updatedItemKey,
			version
		}, {
			database: this.knex,
			schema: this.schema,
			accountability: this.accountability
		});
		return updatedItemKey;
	}
	async assertSingletonEmpty(collection) {
		const collectionMeta = this.schema.collections[collection];
		if (!collectionMeta?.singleton) return;
		if (await this.knex(collection).first(collectionMeta.primary)) throw new UnprocessableContentError({ reason: `Singleton collection "${collection}" already contains an item` });
	}
	mapDelta(version) {
		const delta = version.delta ?? {};
		delta[this.schema.collections[version.collection].primary] = version.item;
		return deepMapWithSchema(delta, ([key, value], context) => {
			if (key === "_user" || key === "_date") return;
			if (context.collection.primary in context.object) {
				if (context.field.special.includes("user-updated")) return [key, context.object["_user"]];
				if (context.field.special.includes("date-updated")) return [key, context.object["_date"]];
			} else {
				if (context.field.special.includes("user-created")) return [key, context.object["_user"]];
				if (context.field.special.includes("date-created")) return [key, context.object["_date"]];
			}
			if (key in context.object) return [key, value];
		}, {
			collection: version.collection,
			schema: this.schema
		}, {
			mapNonExistentFields: true,
			detailedUpdateSyntax: true
		});
	}
};
/** Deeply maps all objects of a structure. Only calls the callback for objects, not for arrays. Objects in arrays will continued to be mapped. */
function deepMapObjects(object, fn, path = []) {
	if (isPlainObject(object) && typeof object === "object" && object !== null) {
		fn(object, path);
		Object.entries(object).map(([key, value]) => deepMapObjects(value, fn, [...path, key]));
	} else if (Array.isArray(object)) object.map((value, index) => deepMapObjects(value, fn, [...path, String(index)]));
}

//#endregion
export { VersionsService };