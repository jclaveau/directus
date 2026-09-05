import { DirectusPreset } from "../../../schema/preset.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/presets.d.ts

/**
 * Delete multiple existing presets.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deletePresets: <Schema>(keys: DirectusPreset<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing preset.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deletePreset: <Schema>(key: DirectusPreset<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deletePreset, deletePresets };
//# sourceMappingURL=presets.d.cts.map