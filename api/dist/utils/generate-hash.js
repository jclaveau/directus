import { getConfigFromEnv } from "./get-config-from-env.js";
import argon2 from "argon2";

//#region src/utils/generate-hash.ts
function generateHash(stringToHash) {
	const argon2HashConfigOptions = getConfigFromEnv("HASH_", { omitPrefix: "HASH_RAW" });
	if ("associatedData" in argon2HashConfigOptions) argon2HashConfigOptions["associatedData"] = Buffer.from(argon2HashConfigOptions["associatedData"]);
	return argon2.hash(stringToHash, argon2HashConfigOptions);
}

//#endregion
export { generateHash };