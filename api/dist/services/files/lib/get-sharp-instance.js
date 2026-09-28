import { useEnv } from "@directus/env";

//#region src/services/files/lib/get-sharp-instance.ts
const loadSharp = async () => (await import("sharp")).default;
async function getSharpInstance() {
	const env = useEnv();
	return (await loadSharp())({
		limitInputPixels: Math.trunc(Math.pow(env["ASSETS_TRANSFORM_IMAGE_MAX_DIMENSION"], 2)),
		sequentialRead: true,
		failOn: env["ASSETS_INVALID_IMAGE_SENSITIVITY_LEVEL"]
	});
}
async function getSharpCounters() {
	return (await loadSharp()).counters();
}

//#endregion
export { getSharpCounters, getSharpInstance };