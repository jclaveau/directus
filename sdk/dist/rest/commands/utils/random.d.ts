import { RestCommand } from "../../types.js";

//#region src/rest/commands/utils/random.d.ts

/**
 * Returns a random string of given length.
 * @param length The length of the generated string
 * @returns Generated string
 */
declare const randomString: <Schema>(length?: number) => RestCommand<string, Schema>;
//#endregion
export { randomString };
//# sourceMappingURL=random.d.ts.map