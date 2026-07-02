import { AuthenticationData, RefreshOptions } from "../../../auth/types.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/auth/refresh.d.ts

/**
 * Retrieve a new access token using a refresh token.
 *
 * @param options Optional refresh settings.
 *
 * @returns The new access and refresh tokens for the session.
 */
declare const refresh: <Schema>(options?: RefreshOptions) => RestCommand<AuthenticationData, Schema>;
//#endregion
export { refresh };
//# sourceMappingURL=refresh.d.ts.map