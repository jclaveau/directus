import { useEnv } from "@directus/env";
import { version } from "directus/version";

//#region src/core-build-id.ts
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "c92c23a2288395922e3c0383dd41e0a6fcb5d94c";
}

//#endregion
export { resolveCoreBuildId };