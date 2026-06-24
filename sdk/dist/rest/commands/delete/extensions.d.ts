import { DirectusExtension } from "../../../schema/extension.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/delete/extensions.d.ts

/**
* Uninstall a registry extension.
* @param id - UUID of the installed extension
* @returns Nothing
* @throws Will throw if id is empty
*/
declare const uninstallRegistryExtension: <Schema>(id: DirectusExtension<Schema>["id"]) => RestCommand<void, Schema>;
/**
* Delete an existing extension.
*
* @param id - UUID of the extension
* @returns Nothing
* @throws Will throw if id is empty
*/
declare const deleteExtension: <Schema>(id: DirectusExtension<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteExtension, uninstallRegistryExtension };
//# sourceMappingURL=extensions.d.ts.map