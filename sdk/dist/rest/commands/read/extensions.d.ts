import { DirectusExtension } from "../../../schema/extension.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/extensions.d.ts

/**
 * List the available extensions in the project.
 * @returns An array of extensions.
 */
declare const readExtensions: <Schema>() => RestCommand<DirectusExtension<Schema>[], Schema>;
//#endregion
export { readExtensions };
//# sourceMappingURL=extensions.d.ts.map