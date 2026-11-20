import { useEnv } from "@directus/env";
import { version } from "directus/version";

//#region src/core-build-id.ts
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "671f6c31d47149aac0d5be3a5bb5972f0282ea2a";
}

//#endregion
export { resolveCoreBuildId };