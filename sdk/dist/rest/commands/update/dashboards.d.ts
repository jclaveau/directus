import { DirectusDashboard } from "../../../schema/dashboard.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/dashboards.d.ts
type UpdateDashboardOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusDashboard<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing dashboards.
* @param keys
* @param item
* @param query
* @returns Returns the dashboard objects for the updated dashboards.
* @throws Will throw if keys is empty
*/
declare const updateDashboards: <Schema, const TQuery extends Query<Schema, DirectusDashboard<Schema>>>(keys: DirectusDashboard<Schema>["id"][], item: NestedPartial<DirectusDashboard<Schema>>, query?: TQuery) => RestCommand<UpdateDashboardOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple dashboards as batch.
* @param items
* @param query
* @returns Returns the dashboard objects for the updated dashboards.
*/
declare const updateDashboardsBatch: <Schema, const TQuery extends Query<Schema, DirectusDashboard<Schema>>>(items: NestedPartial<DirectusDashboard<Schema>>[], query?: TQuery) => RestCommand<UpdateDashboardOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing dashboard.
* @param key
* @param item
* @param query
* @returns Returns the dashboard object for the updated dashboard.
* @throws Will throw if key is empty
*/
declare const updateDashboard: <Schema, const TQuery extends Query<Schema, DirectusDashboard<Schema>>>(key: DirectusDashboard<Schema>["id"], item: NestedPartial<DirectusDashboard<Schema>>, query?: TQuery) => RestCommand<UpdateDashboardOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateDashboardOutput, updateDashboard, updateDashboards, updateDashboardsBatch };
//# sourceMappingURL=dashboards.d.ts.map