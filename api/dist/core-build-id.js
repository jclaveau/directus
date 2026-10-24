import { useEnv } from "@directus/env";
import { version } from "directus/version";

//#region src/core-build-id.ts
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "5533248b5dbd769a64d2b1e9a6a355ba9828182a";
}

//#endregion
export { resolveCoreBuildId };