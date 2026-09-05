import { DirectusFile } from "../../../schema/file.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/files.d.ts
type ReadFileOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusFile<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all files that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit file objects. If no items are available, data will be an empty array.
 */
declare const readFiles: <Schema, const TQuery extends Query<Schema, DirectusFile<Schema>>>(query?: TQuery) => RestCommand<ReadFileOutput<Schema, TQuery>[], Schema>;
/**
 * Retrieve a single file by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns a file object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readFile: <Schema, const TQuery extends Query<Schema, DirectusFile<Schema>>>(key: DirectusFile<Schema>["id"], query?: TQuery) => RestCommand<ReadFileOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadFileOutput, readFile, readFiles };
//# sourceMappingURL=files.d.ts.map