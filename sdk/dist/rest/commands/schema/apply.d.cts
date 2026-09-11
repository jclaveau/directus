import { RestCommand } from "../../types.cjs";
import { SchemaDiffOutput } from "./diff.cjs";

//#region src/rest/commands/schema/apply.d.ts

/**
 * Update the instance's schema by passing the diff previously retrieved via /schema/diff endpoint in the request body. This endpoint is only available to admin users.
 * @param diff JSON object containing hash and diffs of collections, fields, and relations to apply.
 * @returns Empty body.
 */
declare const schemaApply: <Schema>(diff: SchemaDiffOutput) => RestCommand<void, Schema>;
//#endregion
export { schemaApply };
//# sourceMappingURL=apply.d.cts.map