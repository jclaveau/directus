import { DirectusPreset } from "../../../schema/preset.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/presets.d.ts
type CreatePresetOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPreset<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new presets.
*
* @param items The presets to create
* @param query Optional return data query
*
* @returns Returns the preset object for the created preset.
*/
declare const createPresets: <Schema, const TQuery extends Query<Schema, DirectusPreset<Schema>>>(items: NestedPartial<DirectusPreset<Schema>>[], query?: TQuery) => RestCommand<CreatePresetOutput<Schema, TQuery>[], Schema>;
/**
* Create a new preset.
*
* @param item The preset to create
* @param query Optional return data query
*
* @returns Returns the preset object for the created preset.
*/
declare const createPreset: <Schema, const TQuery extends Query<Schema, DirectusPreset<Schema>>>(item: NestedPartial<DirectusPreset<Schema>>, query?: TQuery) => RestCommand<CreatePresetOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreatePresetOutput, createPreset, createPresets };
//# sourceMappingURL=presets.d.cts.map