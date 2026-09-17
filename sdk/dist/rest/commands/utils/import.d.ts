import { RestCommand } from "../../types.js";

//#region src/rest/commands/utils/import.d.ts

/**
 * Import multiple records from a JSON or CSV file into a collection.
 * @returns Nothing
 */
declare const utilsImport: <Schema>(collection: keyof Schema, data: FormData) => RestCommand<void, Schema>;
//#endregion
export { utilsImport };
//# sourceMappingURL=import.d.ts.map