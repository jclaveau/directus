import { DirectusTranslation } from "../../../schema/translation.js";
import { NestedPartial } from "../../../types/utils.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/create/translations.d.ts
type CreateTranslationOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusTranslation<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new translation.
*
* @param items The translations to create
* @param query Optional return data query
*
* @returns Returns the translation object for the created translation.
*/
declare const createTranslations: <Schema, const TQuery extends Query<Schema, DirectusTranslation<Schema>>>(items: NestedPartial<DirectusTranslation<Schema>>[], query?: TQuery) => RestCommand<CreateTranslationOutput<Schema, TQuery>[], Schema>;
/**
* Create a new translation.
*
* @param item The translation to create
* @param query Optional return data query
*
* @returns Returns the translation object for the created translation.
*/
declare const createTranslation: <Schema, const TQuery extends Query<Schema, DirectusTranslation<Schema>>>(item: NestedPartial<DirectusTranslation<Schema>>, query?: TQuery) => RestCommand<CreateTranslationOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateTranslationOutput, createTranslation, createTranslations };
//# sourceMappingURL=translations.d.ts.map