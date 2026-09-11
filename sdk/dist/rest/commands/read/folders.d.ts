import { DirectusFolder } from "../../../schema/folder.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/folders.d.ts
type ReadFolderOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusFolder<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all folders that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit folder objects. If no items are available, data will be an empty array.
 */
declare const readFolders: <Schema, const TQuery extends Query<Schema, DirectusFolder<Schema>>>(query?: TQuery) => RestCommand<ReadFolderOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing folder by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns a folder object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readFolder: <Schema, const TQuery extends Query<Schema, DirectusFolder<Schema>>>(key: DirectusFolder<Schema>["id"], query?: TQuery) => RestCommand<ReadFolderOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadFolderOutput, readFolder, readFolders };
//# sourceMappingURL=folders.d.ts.map