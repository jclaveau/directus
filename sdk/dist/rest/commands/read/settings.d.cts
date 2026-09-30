import { DirectusSettings } from "../../../schema/settings.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/settings.d.ts
type ReadSettingOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusSettings<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * Retrieve Settings.
 *
 * @param query The query parameters
 *
 * @returns Returns the settings object.
 */
declare const readSettings: <Schema, const TQuery extends Query<Schema, DirectusSettings<Schema>>>(query?: TQuery) => RestCommand<ReadSettingOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadSettingOutput, readSettings };
//# sourceMappingURL=settings.d.cts.map