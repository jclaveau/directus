import { DirectusDashboard } from "../../../schema/dashboard.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/dashboards.d.ts
type ReadDashboardOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusDashboard<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all dashboards that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit dashboard objects. If no items are available, data will be an empty array.
 */
declare const readDashboards: <Schema, const TQuery extends Query<Schema, DirectusDashboard<Schema>>>(query?: TQuery) => RestCommand<ReadDashboardOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing dashboard by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns the requested dashboard object.
 * @throws Will throw if key is empty
 */
declare const readDashboard: <Schema, const TQuery extends Query<Schema, DirectusDashboard<Schema>>>(key: DirectusDashboard<Schema>["id"], query?: TQuery) => RestCommand<ReadDashboardOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadDashboardOutput, readDashboard, readDashboards };
//# sourceMappingURL=dashboards.d.cts.map