import { ItemsService } from "./items.js";
import { getHistoryFilterQuery } from "../utils/get-history-filter-query.js";
import { ForbiddenError, InvalidPayloadError } from "@directus/errors";

//#region src/services/revisions.ts
var RevisionsService = class extends ItemsService {
	queryCache = /* @__PURE__ */ new WeakMap();
	constructor(options) {
		super("directus_revisions", options);
	}
	async revert(pk) {
		const revision = await super.readOne(pk);
		if (!revision) throw new ForbiddenError();
		if (!revision["data"]) throw new InvalidPayloadError({ reason: `Revision doesn't contain data to revert to` });
		await new ItemsService(revision["collection"], {
			accountability: this.accountability,
			knex: this.knex,
			schema: this.schema
		}).updateOne(revision["item"], revision["data"]);
	}
	setDefaultOptions(opts) {
		if (!opts) return {
			autoPurgeCache: false,
			bypassLimits: true
		};
		if (!("autoPurgeCache" in opts)) opts.autoPurgeCache = false;
		if (!("bypassLimits" in opts)) opts.bypassLimits = true;
		return opts;
	}
	async createOne(data, opts) {
		return super.createOne(data, this.setDefaultOptions(opts));
	}
	async createMany(data, opts) {
		return super.createMany(data, this.setDefaultOptions(opts));
	}
	async updateOne(key, data, opts) {
		return super.updateOne(key, data, this.setDefaultOptions(opts));
	}
	async updateMany(keys, data, opts) {
		return super.updateMany(keys, data, this.setDefaultOptions(opts));
	}
	async readByQuery(query, opts) {
		if (this.accountability === null) return super.readByQuery(query, opts);
		const historyQuery = this.getLimitedHistoryQuery(query);
		return super.readByQuery(historyQuery, opts);
	}
	getLimitedHistoryQuery(query) {
		let cachedQuery = this.queryCache.get(query);
		if (!cachedQuery) {
			cachedQuery = getHistoryFilterQuery(query, "revision_historical_timeframe", (sinceDate) => ({ activity: { timestamp: { _gte: sinceDate.toISOString() } } }));
			this.queryCache.set(query, cachedQuery);
		}
		return cachedQuery;
	}
};

//#endregion
export { RevisionsService };