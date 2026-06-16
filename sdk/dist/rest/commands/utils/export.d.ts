import { DirectusFile } from "../../../schema/file.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/utils/export.d.ts
type FileFormat = "csv" | "csv_utf8" | "json" | "xml" | "yaml";
/**
* Export a larger data set to a file in the File Library
* @returns Nothing
*/
declare const utilsExport: <Schema, TQuery extends Query<Schema, Schema[Collection]>, Collection extends keyof Schema>(collection: Collection, format: FileFormat, query: TQuery, file: Partial<DirectusFile<Schema>>) => RestCommand<void, Schema>;
//#endregion
export { FileFormat, utilsExport };
//# sourceMappingURL=export.d.ts.map