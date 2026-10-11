import { DirectusComment } from "../../../schema/comment.cjs";
import { Query } from "../../../types/query.cjs";
import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/delete/comments.d.ts

/**
 * Delete multiple existing comments.
 * @param keysOrQuery The primary keys or a query
 * @returns
 * @throws Will throw if keys is empty
 */
declare const deleteComments: <Schema>(keysOrQuery: DirectusComment<Schema>["id"][] | Query<Schema, DirectusComment<Schema>>) => RestCommand<void, Schema>;
/**
 * Delete an existing comment.
 * @param key
 * @returns
 * @throws Will throw if key is empty
 */
declare const deleteComment: <Schema>(key: DirectusComment<Schema>["id"]) => RestCommand<void, Schema>;
//#endregion
export { deleteComment, deleteComments };
//# sourceMappingURL=comments.d.cts.map