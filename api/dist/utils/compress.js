import { compress as compress$1, decompress as decompress$1 } from "@directus/utils";
import { compress as compress$2, uncompress } from "snappy";

//#region src/utils/compress.ts
async function compress(raw) {
	if (!raw) return raw;
	return await compress$2(compress$1(raw));
}
async function decompress(compressed) {
	if (!compressed) return compressed;
	return decompress$1(await uncompress(compressed, { asBuffer: false }));
}

//#endregion
export { compress, decompress };