import { DirectusPreset } from "../../../schema/preset.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/presets.d.ts
type ReadPresetOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusPreset<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all Presets that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit Preset objects. If no items are available, data will be an empty array.
 */
declare const readPresets: <Schema, const TQuery extends Query<Schema, DirectusPreset<Schema>>>(query?: TQuery) => RestCommand<ReadPresetOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing preset by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns a Preset object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readPreset: <Schema, const TQuery extends Query<Schema, DirectusPreset<Schema>>>(key: DirectusPreset<Schema>["id"], query?: TQuery) => RestCommand<ReadPresetOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadPresetOutput, readPreset, readPresets };
//# sourceMappingURL=presets.d.cts.map