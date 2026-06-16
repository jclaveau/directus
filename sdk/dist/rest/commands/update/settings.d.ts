import { DirectusSettings } from "../../../schema/settings.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/settings.d.ts
type UpdateSettingOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusSettings<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update Settings
* @param item
* @param query
* @returns Returns the settings object.
*/
declare const updateSettings: <Schema, const TQuery extends Query<Schema, DirectusSettings<Schema>>>(item: NestedPartial<DirectusSettings<Schema>>, query?: TQuery) => RestCommand<UpdateSettingOutput<Schema, TQuery>[], Schema>;
//#endregion
export { UpdateSettingOutput, updateSettings };
//# sourceMappingURL=settings.d.ts.map