import { DirectusFlow } from "../../../schema/flow.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/delete/flows.d.ts

/**
 * Delete multiple existing flows.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteFlows: <Schema>(keys: DirectusFlow<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing flow.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteFlow: <Schema>(key: DirectusFlow<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteFlow, deleteFlows };
//# sourceMappingURL=flows.d.ts.map