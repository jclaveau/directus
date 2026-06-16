import { join } from "path";
import { useEnv } from "@directus/env";

//#region src/extensions/lib/get-extensions-path.ts
const getExtensionsPath = () => {
	const env = useEnv();
	if (env["EXTENSIONS_LOCATION"]) return join(env["TEMP_PATH"], "extensions");
	return env["EXTENSIONS_PATH"];
};

//#endregion
export { getExtensionsPath };