import { DirectusPreset } from "../../../schema/preset.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/update/presets.d.ts
type UpdatePresetOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPreset<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing presets.
* @param keys
* @param item
* @param query
* @returns Returns the preset objects for the updated presets.
* @throws Will throw if keys is empty
*/
declare const updatePresets: <Schema, const TQuery extends Query<Schema, DirectusPreset<Schema>>>(keys: DirectusPreset<Schema>["id"][], item: NestedPartial<DirectusPreset<Schema>>, query?: TQuery) => RestCommand<UpdatePresetOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple presets as batch.
* @param items
* @param query
* @returns Returns the preset objects for the updated presets.
*/
declare const updatePresetsBatch: <Schema, const TQuery extends Query<Schema, DirectusPreset<Schema>>>(items: NestedPartial<DirectusPreset<Schema>>[], query?: TQuery) => RestCommand<UpdatePresetOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing preset.
* @param key
* @param item
* @param query
* @returns Returns the preset object for the updated preset.
* @throws Will throw if key is empty
*/
declare const updatePreset: <Schema, const TQuery extends Query<Schema, DirectusPreset<Schema>>>(key: DirectusPreset<Schema>["id"], item: NestedPartial<DirectusPreset<Schema>>, query?: TQuery) => RestCommand<UpdatePresetOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdatePresetOutput, updatePreset, updatePresets, updatePresetsBatch };
//# sourceMappingURL=presets.d.ts.map