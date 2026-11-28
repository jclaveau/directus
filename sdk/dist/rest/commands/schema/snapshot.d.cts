import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/schema/snapshot.d.ts
type SchemaSnapshotOutput = {
  version: number;
  directus: string;
  vendor: string;
  collections: Record<string, any>[];
  fields: Record<string, any>[];
  relations: Record<string, any>[];
};
/**
 * Retrieve the current schema. This endpoint is only available to admin users.
 * @returns Returns the JSON object containing schema details.
 */
declare const schemaSnapshot: <Schema>() => RestCommand<SchemaSnapshotOutput, Schema>;
//#endregion
export { SchemaSnapshotOutput, schemaSnapshot };
//# sourceMappingURL=snapshot.d.cts.map