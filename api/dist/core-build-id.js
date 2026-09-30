import { useEnv } from "@directus/env";
import { version } from "directus/version";

//#region src/core-build-id.ts
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "9cef89fcc0cc22aa16b281b96a414d977cbc2b0c";
}

//#endregion
export { resolveCoreBuildId };