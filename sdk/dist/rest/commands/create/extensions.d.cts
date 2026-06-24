import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/extensions.d.ts

/**
* Install an extension from the registry.
* @param extensionId - Registry extension ID
* @param version - Version ID to install
* @returns Nothing
* @throws Will throw if extensionId or version is empty
*/
declare const installRegistryExtension: <Schema>(extensionId: string, version: string) => RestCommand<void, Schema>;
//#endregion
export { installRegistryExtension };
//# sourceMappingURL=extensions.d.cts.map