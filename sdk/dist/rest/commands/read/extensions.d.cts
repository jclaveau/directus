import { DirectusExtension } from "../../../schema/extension.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/extensions.d.ts

/**
 * List the available extensions in the project.
 * @returns An array of extensions.
 */
declare const readExtensions: <Schema>() => RestCommand<DirectusExtension<Schema>[], Schema>;
//#endregion
export { readExtensions };
//# sourceMappingURL=extensions.d.cts.map