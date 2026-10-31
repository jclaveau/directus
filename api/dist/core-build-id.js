import { useEnv } from "@directus/env";
import { version } from "directus/version";

//#region src/core-build-id.ts
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "7ebfdcfc4d391eebc39beee9d70be67d9812809f";
}

//#endregion
export { resolveCoreBuildId };