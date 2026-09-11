import { DirectusExtension } from "../../../schema/extension.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/extensions.d.ts

/**
 * Update an existing extension.
 * @param bundle - Bundle this extension is in
 * @param name - Unique name of the extension
 * @param data - Partial extension object
 * @returns Returns the extension that was updated
 */
declare const updateExtension: <Schema>(bundle: string | null, name: string, data: NestedPartial<DirectusExtension<Schema>>) => RestCommand<DirectusExtension<Schema>, Schema>;
//#endregion
export { updateExtension };
//# sourceMappingURL=extensions.d.cts.map