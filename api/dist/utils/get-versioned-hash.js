import hash from "object-hash";
import { version } from "directus/version";

//#region src/utils/get-versioned-hash.ts
function getVersionedHash(item) {
	return hash({
		item,
		version
	});
}

//#endregion
export { getVersionedHash };