import { DirectusFile } from "../../../schema/file.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

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
//# sourceMappingURL=files.d.cts.map