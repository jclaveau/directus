import { DirectusTranslation } from "../../../schema/translation.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/translations.d.ts
type ReadTranslationOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusTranslation<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all Translations that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit Translation objects. If no items are available, data will be an empty array.
 */
declare const readTranslations: <Schema, const TQuery extends Query<Schema, DirectusTranslation<Schema>>>(query?: TQuery) => RestCommand<ReadTranslationOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing Translation by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns a Translation object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readTranslation: <Schema, const TQuery extends Query<Schema, DirectusTranslation<Schema>>>(key: DirectusTranslation<Schema>["id"], query?: TQuery) => RestCommand<ReadTranslationOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadTranslationOutput, readTranslation, readTranslations };
//# sourceMappingURL=translations.d.cts.map