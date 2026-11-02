import { useEnv } from "@directus/env";
import { version } from "directus/version";

//#region src/core-build-id.ts
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "b1534cce66d7d00b592df585c9ee2e9b0b655f4f";
}

//#endregion
export { resolveCoreBuildId };