import { DirectusFlow } from "../../../schema/flow.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/flows.d.ts
type ReadFlowOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusFlow<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all flows that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit flow objects. If no items are available, data will be an empty array.
 */
declare const readFlows: <Schema, const TQuery extends Query<Schema, DirectusFlow<Schema>>>(query?: TQuery) => RestCommand<ReadFlowOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing flow by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns the requested flow object.
 * @throws Will throw if key is empty
 */
declare const readFlow: <Schema, const TQuery extends Query<Schema, DirectusFlow<Schema>>>(key: DirectusFlow<Schema>["id"], query?: TQuery) => RestCommand<ReadFlowOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadFlowOutput, readFlow, readFlows };
//# sourceMappingURL=flows.d.cts.map