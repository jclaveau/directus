import { DirectusComment } from "../../../schema/comment.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/read/comments.d.ts
type ReadCommentOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusComment<Schema>> = ApplyQueryFields<Schema, Item, TQuery['fields']>;
/**
 * List all Comments that exist in Directus.
 * @param query The query parameters
 * @returns An array of up to limit Comment objects. If no items are available, data will be an empty array.
 */
declare const readComments: <Schema, const TQuery extends Query<Schema, DirectusComment<Schema>>>(query?: TQuery) => RestCommand<ReadCommentOutput<Schema, TQuery>[], Schema>;
/**
 * List an existing comment by primary key.
 * @param key The primary key of the dashboard
 * @param query The query parameters
 * @returns Returns a Comment object if a valid primary key was provided.
 * @throws Will throw if key is empty
 */
declare const readComment: <Schema, const TQuery extends Query<Schema, DirectusComment<Schema>>>(key: DirectusComment<Schema>["id"], query?: TQuery) => RestCommand<ReadCommentOutput<Schema, TQuery>, Schema>;
//#endregion
export { ReadCommentOutput, readComment, readComments };
//# sourceMappingURL=comments.d.cts.map