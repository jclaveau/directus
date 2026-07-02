import { ItemsService } from "./items.js";

//#region src/services/settings.ts
var SettingsService = class extends ItemsService {
	constructor(options) {
		super("directus_settings", options);
	}
};

//#endregion
export { SettingsService };