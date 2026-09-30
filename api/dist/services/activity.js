import { ItemsService } from "./items.js";

//#region src/services/activity.ts
var ActivityService = class extends ItemsService {
	constructor(options) {
		super("directus_activity", options);
	}
};

//#endregion
export { ActivityService };