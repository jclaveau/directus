import { RestCommand } from "../../types.cjs";

//#region src/rest/commands/utils/cache.d.ts

/**
 * Resets both the data and schema cache of Directus. This endpoint is only available to admin users.
 * @returns Nothing
 */
declare const clearCache: <Schema>() => RestCommand<void, Schema>;
//#endregion
export { clearCache };
//# sourceMappingURL=cache.d.cts.map