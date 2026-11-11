import { useEnv } from "@directus/env";
import { version } from "directus/version";

//#region src/core-build-id.ts
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "01590003184fdcb6d27d38407dc4fc9aa8aed943";
}

//#endregion
export { resolveCoreBuildId };