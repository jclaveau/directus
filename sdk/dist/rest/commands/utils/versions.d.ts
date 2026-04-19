import { DirectusVersion } from "../../../schema/version.js";
import { NestedPartial, UnpackList } from "../../../types/utils.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/utils/versions.d.ts

/**
* Save item changes to an existing Content Version.
*
* @param id Primary key of the Content Version.
* @param item The item changes to save to the specified Content Version.
*
* @returns State of the item after save.
*/
declare const saveToContentVersion: <Schema, Collection extends keyof Schema, Item = UnpackList<Schema[Collection]>>(id: DirectusVersion<Schema>["id"], item: NestedPartial<Item>) => RestCommand<Item, Schema>;
/**
* Compare an existing Content Version with the main version of the item.
*
* @param id Primary key of the Content Version.
*
* @returns All fields with different values, along with the hash of the main version of the item and the information
whether the Content Version is outdated (i.e. main version of the item has been updated since the creation of the
Content Version)
*/
declare const compareContentVersion: <Schema, Collection extends keyof Schema, Item = UnpackList<Schema[Collection]>>(id: DirectusVersion<Schema>["id"]) => RestCommand<{
  outdated: boolean;
  mainHash: string;
  current: Partial<Item>;
  main: Item;
}, Schema>;
/**
* Promote an existing Content Version to become the new main version of the item.
*
* @param id Primary key of the version.
* @param mainHash The current hash of the main version of the item (obtained from the `compare` endpoint).
* @param fields Optional array of field names of which the values are to be promoted. By default, all fields are selected.
*
* @returns The primary key of the promoted item.
*/
declare const promoteContentVersion: <Schema, Collection extends keyof Schema, Item = UnpackList<Schema[Collection]>>(id: DirectusVersion<Schema>["id"], mainHash: string, fields?: (keyof UnpackList<Item>)[]) => RestCommand<string | number, Schema>;
//#endregion
export { compareContentVersion, promoteContentVersion, saveToContentVersion };
//# sourceMappingURL=versions.d.ts.map