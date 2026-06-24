import { DirectusExtension } from "../../../schema/extension.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/extensions.d.ts

/**
* Reinstall an extension from the registry.
* @param extensionId - Registry extension ID
* @returns Nothing
* @throws Will throw if extensionId is empty
*/
declare const reinstallRegistryExtension: <Schema>(extensionId: string) => RestCommand<void, Schema>;
/**
* Update an existing extension.
* @param id - UUID of the extension
* @param data - Partial extension object
* @returns Returns the extension that was updated
*/
declare const updateExtension: <Schema>(id: DirectusExtension<Schema>["id"], data: NestedPartial<DirectusExtension<Schema>>) => RestCommand<DirectusExtension<Schema>, Schema>;
//#endregion
export { reinstallRegistryExtension, updateExtension };
//# sourceMappingURL=extensions.d.cts.map