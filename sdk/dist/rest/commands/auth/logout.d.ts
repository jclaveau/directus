import { LogoutOptions } from "../../../auth/types.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/auth/logout.d.ts

/**
 * Invalidate the refresh token thus destroying the user's session.
 *
 * @param options Optional logout settings.
 *
 * @returns Empty body.
 */
declare const logout: <Schema>(options?: LogoutOptions) => RestCommand<void, Schema>;
//#endregion
export { logout };
//# sourceMappingURL=logout.d.ts.map