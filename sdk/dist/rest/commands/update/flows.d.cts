import { DirectusFlow } from "../../../schema/flow.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/flows.d.ts
type UpdateFlowOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusFlow<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing flows.
* @param keys
* @param item
* @param query
* @returns Returns the flow objects for the updated flows.
* @throws Will throw if keys is empty
*/
declare const updateFlows: <Schema, const TQuery extends Query<Schema, DirectusFlow<Schema>>>(keys: DirectusFlow<Schema>["id"][], item: NestedPartial<DirectusFlow<Schema>>, query?: TQuery) => RestCommand<UpdateFlowOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple flows as batch.
* @param items
* @param query
* @returns Returns the flow objects for the updated flows.
*/
declare const updateFlowsBatch: <Schema, const TQuery extends Query<Schema, DirectusFlow<Schema>>>(items: NestedPartial<DirectusFlow<Schema>>[], query?: TQuery) => RestCommand<UpdateFlowOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing flow.
* @param key
* @param item
* @param query
* @returns Returns the flow object for the updated flow.
* @throws Will throw if key is empty
*/
declare const updateFlow: <Schema, const TQuery extends Query<Schema, DirectusFlow<Schema>>>(key: DirectusFlow<Schema>["id"], item: NestedPartial<DirectusFlow<Schema>>, query?: TQuery) => RestCommand<UpdateFlowOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateFlowOutput, updateFlow, updateFlows, updateFlowsBatch };
//# sourceMappingURL=flows.d.cts.map