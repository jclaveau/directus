import { getRegistryRootPath } from "./get-registry-root-path.js";
import { useEnv } from "@directus/env";
import { join } from "node:path";
import { resolveFsExtensions, resolveModuleExtensions } from "@directus/extensions/node";

//#region src/extensions/lib/get-extensions.ts
const getExtensions = async () => {
	const env = useEnv();
	return {
		registry: await resolveFsExtensions(join(getRegistryRootPath(), ".registry")),
		module: await resolveModuleExtensions(env["PACKAGE_FILE_LOCATION"])
	};
};

//#endregion
export { getExtensions };