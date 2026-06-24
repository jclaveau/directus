import { pathToRelativeUrl } from "@directus/utils/node";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

//#region src/utils/import-file-url.ts
function importFileUrl(url, root, options = {}) {
	return import(`./${pathToRelativeUrl(url, dirname(fileURLToPath(root)))}${options.fresh ? `?t=${Date.now()}` : ""}`);
}

//#endregion
export { importFileUrl };