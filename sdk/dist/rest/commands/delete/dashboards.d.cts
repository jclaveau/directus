import { DirectusDashboard } from "../../../schema/dashboard.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/dashboards.d.ts

/**
 * Delete multiple existing dashboards.
 * @param keysOrQuery
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteDashboards: <Schema>(keys: DirectusDashboard<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing dashboard.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteDashboard: <Schema>(key: DirectusDashboard<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteDashboard, deleteDashboards };
//# sourceMappingURL=dashboards.d.cts.map