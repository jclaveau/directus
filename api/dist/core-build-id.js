import { useEnv } from "@directus/env";
import { version } from "directus/version";

//#region src/core-build-id.ts
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "1a6b29503ed613b5d3a35d734ca495dd804dd0e1";
}

//#endregion
export { resolveCoreBuildId };