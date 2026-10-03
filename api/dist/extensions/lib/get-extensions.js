import { getExtensionsPath } from "./get-extensions-path.js";
import { useEnv } from "@directus/env";
import { join } from "node:path";
import { resolveFsExtensions, resolveModuleExtensions } from "@directus/extensions/node";

//#region src/extensions/lib/get-extensions.ts
const getExtensions = async () => {
	const env = useEnv();
	return {
		local: await resolveFsExtensions(getExtensionsPath()),
		registry: await resolveFsExtensions(join(getExtensionsPath(), ".registry")),
		module: await resolveModuleExtensions(env["PACKAGE_FILE_LOCATION"])
	};
};

//#endregion
export { getExtensions };