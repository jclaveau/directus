import { ItemsService } from "./items.js";
import { getHistoryFilterQuery } from "../utils/get-history-filter-query.js";

//#region src/services/activity.ts
var ActivityService = class extends ItemsService {
	queryCache = /* @__PURE__ */ new WeakMap();
	constructor(options) {
		super("directus_activity", options);
	}
	async readByQuery(query, opts) {
		if (this.accountability === null) return super.readByQuery(query, opts);
		const historyQuery = this.getLimitedHistoryQuery(query);
		return super.readByQuery(historyQuery, opts);
	}
	getLimitedHistoryQuery(query) {
		let cachedQuery = this.queryCache.get(query);
		if (!cachedQuery) {
			cachedQuery = getHistoryFilterQuery(query, "activity_historical_timeframe", (sinceDate) => ({ timestamp: { _gte: sinceDate.toISOString() } }));
			this.queryCache.set(query, cachedQuery);
		}
		return cachedQuery;
	}
};

//#endregion
export { ActivityService };