import { RestCommand } from "../../types.js";
import { SchemaSnapshotOutput } from "./snapshot.js";

//#region src/rest/commands/schema/diff.d.ts
type SchemaDiffOutput = {
  hash: string;
  diff: Record<string, any>;
};
/**
 * Compare the current instance's schema against the schema snapshot in JSON request body and retrieve the difference. This endpoint is only available to admin users.
 * @param snapshot JSON object containing collections, fields, and relations to apply.
 * @param force Bypass version and database vendor restrictions.
 * @returns Returns the differences between the current instance's schema and the schema passed in the request body.
 */
declare const schemaDiff: <Schema>(snapshot: SchemaSnapshotOutput, force?: boolean) => RestCommand<SchemaDiffOutput, Schema>;
//#endregion
export { SchemaDiffOutput, schemaDiff };
//# sourceMappingURL=diff.d.ts.map