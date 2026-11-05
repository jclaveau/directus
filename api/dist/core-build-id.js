import { useEnv } from "@directus/env";
import { version } from "directus/version";

//#region src/core-build-id.ts
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "287c025a37d5b30ba8ed5bf49dd7b37cfe0d02fd";
}

//#endregion
export { resolveCoreBuildId };