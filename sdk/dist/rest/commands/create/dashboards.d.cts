import { DirectusDashboard } from "../../../schema/dashboard.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/dashboards.d.ts
type CreateDashboardOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusDashboard<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new dashboards.
*
* @param items The items to create
* @param query Optional return data query
*
* @returns Returns the dashboard object for the created dashboards.
*/
declare const createDashboards: <Schema, const TQuery extends Query<Schema, DirectusDashboard<Schema>>>(items: NestedPartial<DirectusDashboard<Schema>>[], query?: TQuery) => RestCommand<CreateDashboardOutput<Schema, TQuery>[], Schema>;
/**
* Create a new dashboard.
*
* @param item The dashboard to create
* @param query Optional return data query
*
* @returns Returns the dashboard object for the created dashboard.
*/
declare const createDashboard: <Schema, const TQuery extends Query<Schema, DirectusDashboard<Schema>>>(item: NestedPartial<DirectusDashboard<Schema>>, query?: TQuery) => RestCommand<CreateDashboardOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateDashboardOutput, createDashboard, createDashboards };
//# sourceMappingURL=dashboards.d.cts.map