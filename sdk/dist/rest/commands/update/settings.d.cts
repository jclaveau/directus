import { DirectusSettings } from "../../../schema/settings.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

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
//# sourceMappingURL=settings.d.cts.map