import { ItemsService } from "./items.js";

//#region src/services/dashboards.ts
var DashboardsService = class extends ItemsService {
	constructor(options) {
		super("directus_dashboards", options);
	}
};

//#endregion
export { DashboardsService };