import { DirectusFlow } from "../../../schema/flow.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

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
//# sourceMappingURL=flows.d.cts.map