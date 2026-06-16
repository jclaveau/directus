import { DirectusPanel } from "../../../schema/panel.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/panels.d.ts
type UpdatePanelOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPanel<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing panels.
* @param keys
* @param item
* @param query
* @returns Returns the panel objects for the updated panels.
* @throws Will throw if keys is empty
*/
declare const updatePanels: <Schema, const TQuery extends Query<Schema, DirectusPanel<Schema>>>(keys: DirectusPanel<Schema>["id"][], item: NestedPartial<DirectusPanel<Schema>>, query?: TQuery) => RestCommand<UpdatePanelOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple panels as batch.
* @param items
* @param query
* @returns Returns the panel objects for the updated panels.
*/
declare const updatePanelsBatch: <Schema, const TQuery extends Query<Schema, DirectusPanel<Schema>>>(items: NestedPartial<DirectusPanel<Schema>>[], query?: TQuery) => RestCommand<UpdatePanelOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing panel.
* @param key
* @param item
* @param query
* @returns Returns the panel object for the updated panel.
* @throws Will throw if key is empty
*/
declare const updatePanel: <Schema, const TQuery extends Query<Schema, DirectusPanel<Schema>>>(key: DirectusPanel<Schema>["id"], item: NestedPartial<DirectusPanel<Schema>>, query?: TQuery) => RestCommand<UpdatePanelOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdatePanelOutput, updatePanel, updatePanels, updatePanelsBatch };
//# sourceMappingURL=panels.d.cts.map