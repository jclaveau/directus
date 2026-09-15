import { DirectusActivity } from "../../../schema/activity.js";
import { ApplyQueryFields } from "../../../types/output.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/read/activity.d.ts
type ReadActivityOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusActivity<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * Returns a list of activity actions.
 * @param query The query parameters
 * @returns An array of up to limit activity objects. If no items are available, data will be an empty array.
 */
declare const readActivities: <Schema, const TQuery extends Query<Schema, DirectusActivity<Schema>>>(query?: TQuery) => RestCommand<ReadActivityOutput<Schema, TQuery>[], Schema>;
/**
 * Returns a single activity action by primary key.
 * @param key The primary key of the activity
 * @param query The query parameters
 * @returns Returns an activity object if a valid identifier was provided.
 * @throws Will throw if key is empty
 */
declare const readActivity: <Schema, const TQuery extends Query<Schema, DirectusActivity<Schema>>>(key: DirectusActivity<Schema>["id"], query?: TQuery) => RestCommand<ReadActivityOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadActivityOutput, readActivities, readActivity };
//# sourceMappingURL=activity.d.ts.map