import { useEnv } from "@directus/env";
import { version } from "directus/version";

//#region src/core-build-id.ts
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "23eb413c0ff78b2ea13bbfe0b9ba07782404c118";
}

//#endregion
export { resolveCoreBuildId };