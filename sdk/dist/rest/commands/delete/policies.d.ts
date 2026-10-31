import { DirectusPolicy } from "../../../schema/policy.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/delete/policies.d.ts

/**
 * Delete multiple existing policies
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deletePolicies: <Schema>(keys: DirectusPolicy<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing policy
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deletePolicy: <Schema>(key: DirectusPolicy<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deletePolicies, deletePolicy };
//# sourceMappingURL=policies.d.ts.map