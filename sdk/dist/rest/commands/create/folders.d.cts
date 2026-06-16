import { DirectusFolder } from "../../../schema/folder.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/folders.d.ts
type CreateFolderOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusFolder<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new (virtual) folders.
*
* @param item The folder to create
* @param query Optional return data query
*
* @returns Returns the folder object of the folder that was created.
*/
declare const createFolders: <Schema, const TQuery extends Query<Schema, DirectusFolder<Schema>>>(items: NestedPartial<DirectusFolder<Schema>>[], query?: TQuery) => RestCommand<CreateFolderOutput<Schema, TQuery>[], Schema>;
/**
* Create a new (virtual) folder.
*
* @param item The folder to create
* @param query Optional return data query
*
* @returns Returns the folder object of the folder that was created.
*/
declare const createFolder: <Schema, const TQuery extends Query<Schema, DirectusFolder<Schema>>>(item: NestedPartial<DirectusFolder<Schema>>, query?: TQuery) => RestCommand<CreateFolderOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateFolderOutput, createFolder, createFolders };
//# sourceMappingURL=folders.d.cts.map