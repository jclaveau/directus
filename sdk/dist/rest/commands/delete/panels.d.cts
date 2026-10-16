import { DirectusPanel } from "../../../schema/panel.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/panels.d.ts

/**
 * Delete multiple existing panels.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deletePanels: <Schema>(keys: DirectusPanel<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing panel.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deletePanel: <Schema>(key: DirectusPanel<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deletePanel, deletePanels };
//# sourceMappingURL=panels.d.cts.map