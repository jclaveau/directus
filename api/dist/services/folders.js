import { ItemsService } from "./items.js";

//#region src/services/folders.ts
var FoldersService = class extends ItemsService {
	constructor(options) {
		super("directus_folders", options);
	}
};

//#endregion
export { FoldersService };