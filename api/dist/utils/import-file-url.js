import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToRelativeUrl } from "@directus/utils/node";

//#region src/utils/import-file-url.ts
function importFileUrl(url$1, root, options = {}) {
	return import(`./${pathToRelativeUrl(url$1, dirname(fileURLToPath(root)))}${options.fresh ? `?t=${Date.now()}` : ""}`);
}

//#endregion
export { importFileUrl };