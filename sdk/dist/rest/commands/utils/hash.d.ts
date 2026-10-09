import { RestCommand } from "../../types.js";

//#region src/rest/commands/utils/hash.d.ts

/**
 * Generate a hash for a given string.
 * @param string String to hash.
 * @returns Hashed string.
 */
declare const generateHash: <Schema>(string: string) => RestCommand<string, Schema>;
/**
 * Verify a string with a hash.
 * @param string Source string.
 * @param hash Hash you want to verify against.
 * @returns Boolean.
 */
declare const verifyHash: <Schema>(string: string, hash: string) => RestCommand<boolean, Schema>;
//#endregion
export { generateHash, verifyHash };
//# sourceMappingURL=hash.d.ts.map