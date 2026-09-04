import { DirectusTranslation } from "../../../schema/translation.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/delete/translations.d.ts

/**
 * Delete multiple existing translations.
 * @param keys
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteTranslations: <Schema>(keys: DirectusTranslation<Schema>["id"][]) => RestCommand<void, Schema>;
/**
 * Delete an existing translation.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteTranslation: <Schema>(key: DirectusTranslation<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteTranslation, deleteTranslations };
//# sourceMappingURL=translations.d.ts.map