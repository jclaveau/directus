import { DirectusComment } from "../../../schema/comment.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/update/comments.d.ts
type UpdateCommentOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusComment<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Update multiple existing comments.
* @param keysOrQuery The primary keys or a query
* @param item
* @param query
* @returns Returns the comment objects for the updated comments.
* @throws Will throw if keys is empty
*/
declare const updateComments: <Schema, const TQuery extends Query<Schema, DirectusComment<Schema>>>(keysOrQuery: DirectusComment<Schema>["id"][] | Query<Schema, DirectusComment<Schema>>, item: NestedPartial<DirectusComment<Schema>>, query?: TQuery) => RestCommand<UpdateCommentOutput<Schema, TQuery>[], Schema>;
/**
* Update multiple comments as batch.
* @param items
* @param query
* @returns Returns the comment objects for the updated comments.
*/
declare const updateCommentsBatch: <Schema, const TQuery extends Query<Schema, DirectusComment<Schema>>>(items: NestedPartial<DirectusComment<Schema>>[], query?: TQuery) => RestCommand<UpdateCommentOutput<Schema, TQuery>[], Schema>;
/**
* Update an existing comment.
* @param key
* @param item
* @param query
* @returns Returns the comment object for the updated comment.
* @throws Will throw if key is empty
*/
declare const updateComment: <Schema, const TQuery extends Query<Schema, DirectusComment<Schema>>>(key: DirectusComment<Schema>["id"], item: NestedPartial<DirectusComment<Schema>>, query?: TQuery) => RestCommand<UpdateCommentOutput<Schema, TQuery>, Schema>;
//#endregion
export { UpdateCommentOutput, updateComment, updateComments, updateCommentsBatch };
//# sourceMappingURL=comments.d.cts.map