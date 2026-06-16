import { DirectusTranslation } from "../../../schema/translation.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/translations.d.ts
type UpdateTranslationOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusTranslation<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing translations.
* @param keys
* @param item
* @param query
* @returns Returns the translation objects for the updated translations.
* @throws Will throw if keys is empty
*/
declare const updateTranslations: <Schema, const TQuery extends Query<Schema, DirectusTranslation<Schema>>>(keys: DirectusTranslation<Schema>["id"][], item: NestedPartial<DirectusTranslation<Schema>>, query?: TQuery) => RestCommand<UpdateTranslationOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple translations as batch.
* @param items
* @param query
* @returns Returns the translation objects for the updated translations.
*/
declare const updateTranslationsBatch: <Schema, const TQuery extends Query<Schema, DirectusTranslation<Schema>>>(items: NestedPartial<DirectusTranslation<Schema>>[], query?: TQuery) => RestCommand<UpdateTranslationOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing translation.
* @param key
* @param item
* @param query
* @returns Returns the translation object for the updated translation.
* @throws Will throw if key is empty
*/
declare const updateTranslation: <Schema, const TQuery extends Query<Schema, DirectusTranslation<Schema>>>(key: DirectusTranslation<Schema>["id"], item: NestedPartial<DirectusTranslation<Schema>>, query?: TQuery) => RestCommand<UpdateTranslationOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateTranslationOutput, updateTranslation, updateTranslations, updateTranslationsBatch };
//# sourceMappingURL=translations.d.cts.map