import { DirectusPanel } from "../../../schema/panel.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/panels.d.ts
type ReadPanelOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPanel<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all Panels that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit panel objects. If no items are available, data will be an empty array.
 */
declare const readPanels: <Schema, const TQuery extends Query<Schema, DirectusPanel<Schema>>>(query?: TQuery) => RestCommand<ReadPanelOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing panel by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns the requested panel object.
 * @throws Will throw if key is empty
 */
declare const readPanel: <Schema, const TQuery extends Query<Schema, DirectusPanel<Schema>>>(key: DirectusPanel<Schema>["id"], query?: TQuery) => RestCommand<ReadPanelOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadPanelOutput, readPanel, readPanels };
//# sourceMappingURL=panels.d.cts.map