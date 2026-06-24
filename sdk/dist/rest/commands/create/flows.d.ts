import { DirectusFlow } from "../../../schema/flow.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/create/flows.d.ts
type CreateFlowOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusFlow<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new flows.
*
* @param items The flows to create
* @param query Optional return data query
*
* @returns Returns the flow object for the created flow.
*/
declare const createFlows: <Schema, const TQuery extends Query<Schema, DirectusFlow<Schema>>>(items: NestedPartial<DirectusFlow<Schema>>[], query?: TQuery) => RestCommand<CreateFlowOutput<Schema, TQuery>[], Schema>;
/**
* Create a new flow.
*
* @param item The flow to create
* @param query Optional return data query
*
* @returns Returns the flow object for the created flow.
*/
declare const createFlow: <Schema, TQuery extends Query<Schema, DirectusFlow<Schema>>>(item: NestedPartial<DirectusFlow<Schema>>, query?: TQuery) => RestCommand<CreateFlowOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateFlowOutput, createFlow, createFlows };
//# sourceMappingURL=flows.d.ts.map