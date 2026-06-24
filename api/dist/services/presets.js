import { ItemsService } from "./items.js";

//#region src/services/presets.ts
var PresetsService = class extends ItemsService {
	constructor(options) {
		super("directus_presets", options);
	}
};

//#endregion
export { PresetsService };