import { useEnv } from "@directus/env";
import { decompress as decompress$1 } from "@directus/utils/values";
import { compress as compress$1, uncompress } from "snappy";

//#region src/utils/compress.ts
async function compress(raw) {
	if (!raw) return raw;
	if (useEnv()["CACHE_COMPRESSION_ENABLED"] === false) return raw;
	return await compress$1(JSON.stringify(raw));
}
async function decompress(compressed) {
	if (!compressed) return compressed;
	if (!Buffer.isBuffer(compressed)) return compressed;
	const text = await uncompress(compressed, { asBuffer: false });
	try {
		return JSON.parse(text);
	} catch {
		return decompress$1(text);
	}
}

//#endregion
export { compress, decompress };