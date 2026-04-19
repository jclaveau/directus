import { DirectusPanel } from "../../../schema/panel.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/create/panels.d.ts
type CreatePanelOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPanel<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new panels.
*
* @param items The panel to create
* @param query Optional return data query
*
* @returns Returns the panel object for the created panel.
*/
declare const createPanels: <Schema, const TQuery extends Query<Schema, DirectusPanel<Schema>>>(items: NestedPartial<DirectusPanel<Schema>>[], query?: TQuery) => RestCommand<CreatePanelOutput<Schema, TQuery>[], Schema>;
/**
* Create a new panel.
*
* @param item The panel to create
* @param query Optional return data query
*
* @returns Returns the panel object for the created panel.
*/
declare const createPanel: <Schema, const TQuery extends Query<Schema, DirectusPanel<Schema>>>(item: NestedPartial<DirectusPanel<Schema>>, query?: TQuery) => RestCommand<CreatePanelOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreatePanelOutput, createPanel, createPanels };
//# sourceMappingURL=panels.d.ts.map