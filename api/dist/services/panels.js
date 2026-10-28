import { ItemsService } from "./items.js";

//#region src/services/panels.ts
var PanelsService = class extends ItemsService {
	constructor(options) {
		super("directus_panels", options);
	}
};

//#endregion
export { PanelsService };