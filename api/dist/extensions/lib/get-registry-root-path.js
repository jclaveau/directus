import { useEnv } from "@directus/env";
import { join } from "node:path";

//#region src/extensions/lib/get-registry-root-path.ts
/**
* The folder holding the Marketplace's `.registry` and the sync `.status`, and
* its prefix in the EXTENSIONS_LOCATION storage.
*/
const REGISTRY_STORAGE_ROOT = "./extensions";
const getRegistryRootPath = () => {
	const env = useEnv();
	if (env["EXTENSIONS_LOCATION"]) return join(env["TEMP_PATH"], "extensions");
	return REGISTRY_STORAGE_ROOT;
};

//#endregion
export { REGISTRY_STORAGE_ROOT, getRegistryRootPath };