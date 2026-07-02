import { DirectusOperation } from "../../../schema/operation.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/delete/operations.d.ts

/**
 * Delete multiple existing operations.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteOperations: <Schema>(keys: DirectusOperation<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing operation.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteOperation: <Schema>(key: DirectusOperation<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteOperation, deleteOperations };
//# sourceMappingURL=operations.d.ts.map