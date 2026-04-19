import { getCache } from "../cache.js";
import emitter_default from "../emitter.js";
import { validateAccess } from "../permissions/modules/validate-access/validate-access.js";
import { PayloadService } from "./payload.js";
import { shouldClearCache } from "../utils/should-clear-cache.js";
import { ItemsService } from "./items.js";
import { ActivityService } from "./activity.js";
import { RevisionsService } from "./revisions.js";
import { ForbiddenError, InvalidPayloadError, UnprocessableContentError } from "@directus/errors";
import { assign, pick } from "lodash-es";
import Joi from "joi";
import hash from "object-hash";
import { Action } from "@directus/constants";

//#region src/services/versions.ts
var VersionsService = class VersionsService extends ItemsService {
	constructor(options) {
		super("directus_versions", options);
	}
	async validateCreateData(data) {
		const { error } = Joi.object({
			key: Joi.string().required(),
			name: Joi.string().allow(null),
			collection: Joi.string().required(),
			item: Joi.string().required()
		}).validate(data);
		if (error) throw new InvalidPayloadError({ reason: error.message });
		if (data["key"] === "main") throw new InvalidPayloadError({ reason: `"main" is a reserved version key` });
		if (this.accountability) try {
			await validateAccess({
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
		if ((await new VersionsService({
			knex: this.knex,
			schema: this.schema
		}).readByQuery({
			aggregate: { count: ["*"] },
			filter: {
				key: { _eq: data["key"] },
				collection: { _eq: data["collection"] },
				item: { _eq: data["item"] }
			}
		}))[0]["count"] > 0) throw new UnprocessableContentError({ reason: `Version "${data["key"]}" already exists for item "${data["item"]}" in collection "${data["collection"]}"` });
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
	async getVersionSaves(key, collection, item) {
		const filter = {
			key: { _eq: key },
			collection: { _eq: collection }
		};
		if (item) filter["item"] = { _eq: item };
		const versions = await this.readByQuery({ filter });
		if (!versions?.[0]) return null;
		if (versions[0]["delta"]) return [versions[0]["delta"]];
		return null;
	}
	async createOne(data, opts) {
		await this.validateCreateData(data);
		data["hash"] = hash(await this.getMainItem(data["collection"], data["item"]));
		return super.createOne(data, opts);
	}
	async createMany(data, opts) {
		if (!Array.isArray(data)) throw new InvalidPayloadError({ reason: "Input should be an array of items" });
		const keyCombos = /* @__PURE__ */ new Set();
		for (const item of data) {
			const keyCombo = `${item["key"]}-${item["collection"]}-${item["item"]}`;
			if (keyCombos.has(keyCombo)) throw new UnprocessableContentError({ reason: `Cannot create multiple versions on "${item["item"]}" in collection "${item["collection"]}" with the same key "${item["key"]}"` });
			keyCombos.add(keyCombo);
		}
		return super.createMany(data, opts);
	}
	async updateMany(keys, data, opts) {
		const { error } = Joi.object({
			key: Joi.string(),
			name: Joi.string().allow(null)
		}).validate(data);
		if (error) throw new InvalidPayloadError({ reason: error.message });
		if ("key" in data) {
			if (data["key"] === "main") throw new InvalidPayloadError({ reason: `"main" is a reserved version key` });
			const keyCombos = /* @__PURE__ */ new Set();
			for (const pk of keys) {
				const { collection, item } = await this.readOne(pk, { fields: ["collection", "item"] });
				const keyCombo = `${data["key"]}-${collection}-${item}`;
				if (keyCombos.has(keyCombo)) throw new UnprocessableContentError({ reason: `Cannot update multiple versions on "${item}" in collection "${collection}" to the same key "${data["key"]}"` });
				keyCombos.add(keyCombo);
				if ((await super.readByQuery({
					aggregate: { count: ["*"] },
					filter: {
						id: { _neq: pk },
						key: { _eq: data["key"] },
						collection: { _eq: collection },
						item: { _eq: item }
					}
				}))[0]["count"] > 0) throw new UnprocessableContentError({ reason: `Version "${data["key"]}" already exists for item "${item}" in collection "${collection}"` });
			}
		}
		return super.updateMany(keys, data, opts);
	}
	async save(key, data) {
		const version = await super.readOne(key);
		const payloadService = new PayloadService(this.collection, {
			accountability: this.accountability,
			knex: this.knex,
			schema: this.schema
		});
		const activityService = new ActivityService({
			knex: this.knex,
			schema: this.schema
		});
		const revisionsService = new RevisionsService({
			knex: this.knex,
			schema: this.schema
		});
		const { item, collection } = version;
		const activity = await activityService.createOne({
			action: Action.VERSION_SAVE,
			user: this.accountability?.user ?? null,
			collection,
			ip: this.accountability?.ip ?? null,
			user_agent: this.accountability?.userAgent ?? null,
			origin: this.accountability?.origin ?? null,
			item
		});
		const revisionDelta = await payloadService.prepareDelta(data);
		await revisionsService.createOne({
			activity,
			version: key,
			collection,
			item,
			data: revisionDelta,
			delta: revisionDelta
		});
		const finalVersionDelta = assign({}, version["delta"], revisionDelta ? JSON.parse(revisionDelta) : null);
		await new ItemsService(this.collection, {
			knex: this.knex,
			schema: this.schema
		}).updateOne(key, { delta: finalVersionDelta });
		const { cache } = getCache();
		if (shouldClearCache(cache, void 0, collection)) cache.clear();
		return finalVersionDelta;
	}
	async promote(version, mainHash, fields) {
		const { collection, item, delta } = await this.readOne(version);
		if (this.accountability) await validateAccess({
			accountability: this.accountability,
			action: "update",
			collection,
			primaryKeys: [item]
		}, {
			schema: this.schema,
			knex: this.knex
		});
		if (!delta) throw new UnprocessableContentError({ reason: `No changes to promote` });
		const { outdated } = await this.verifyHash(collection, item, mainHash);
		if (outdated) throw new UnprocessableContentError({ reason: `Main item has changed since this version was last updated` });
		const payloadToUpdate = fields ? pick(delta, fields) : delta;
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
		const updatedItemKey = await itemsService.updateOne(item, payloadAfterHooks);
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
};

//#endregion
export { VersionsService };