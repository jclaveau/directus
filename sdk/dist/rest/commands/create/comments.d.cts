import { DirectusComment } from "../../../schema/comment.cjs";
import { NestedPartial } from "../../../types/utils.cjs";
import { ApplyQueryFields } from "../../../types/output.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/create/comments.d.ts
type CreateCommentOutput<Schema, TQuery extends Query<Schema, Item>, Item extends object = DirectusComment<Schema>> = ApplyQueryFields<Schema, Item, TQuery["fields"]>;
/**
* Create multiple new comments.
*
* @param items The comments to create
* @param query Optional return data query
*
* @returns Returns the comment object for the created comment.
*/
declare const createComments: <Schema, const TQuery extends Query<Schema, DirectusComment<Schema>>>(items: NestedPartial<DirectusComment<Schema>>[], query?: TQuery) => RestCommand<CreateCommentOutput<Schema, TQuery>[], Schema>;
/**
* Create a new comment.
*
* @param item The comment to create
* @param query Optional return data query
*
* @returns Returns the comment object for the created comment.
*/
declare const createComment: <Schema, const TQuery extends Query<Schema, DirectusComment<Schema>>>(item: NestedPartial<DirectusComment<Schema>>, query?: TQuery) => RestCommand<CreateCommentOutput<Schema, TQuery>, Schema>;
//#endregion
export { CreateCommentOutput, createComment, createComments };
//# sourceMappingURL=comments.d.cts.map