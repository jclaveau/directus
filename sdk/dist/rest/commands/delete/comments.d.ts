import { DirectusComment } from "../../../schema/comment.js";
import { Query } from "../../../types/query.js";
import { RestCommand } from "../../types.js";

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
//# sourceMappingURL=comments.d.ts.map