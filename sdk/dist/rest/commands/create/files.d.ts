import { DirectusFile } from "../../../schema/file.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/create/files.d.ts
type CreateFileOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusFile<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Upload/create a new file.
*
* @param data Formdata object
* @param query The query parameters
*
* @returns Returns the file object for the uploaded file, or an array of file objects if multiple files were uploaded at once.
*/
declare const uploadFiles: <Schema, const TQuery extends Query<Schema, DirectusFile<Schema>>>(data: FormData, query?: TQuery) => RestCommand<CreateFileOutput<Schema, TQuery>, Schema>;
/**
* Import a file from the web
*
* @param url The url to import the file from
* @param data Formdata object
* @param query The query parameters
*
* @returns Returns the file object for the imported file.
*/
declare const importFile: <Schema, TQuery extends Query<Schema, DirectusFile<Schema>>>(url: string, data?: NestedPartial<DirectusFile<Schema>>, query?: TQuery) => RestCommand<CreateFileOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateFileOutput, importFile, uploadFiles };
//# sourceMappingURL=files.d.ts.map