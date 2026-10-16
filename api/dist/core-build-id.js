import { useEnv } from "@directus/env";
import { version } from "directus/version";

//#region src/core-build-id.ts
function resolveCoreBuildId() {
	const explicit = useEnv()["CACHE_BUILD_ID"];
	if (typeof explicit === "string" && explicit.length > 0) return explicit;
	return "2a8b247152e89572a776ac9b4e431bb29e99f2fe";
}

//#endregion
export { resolveCoreBuildId };