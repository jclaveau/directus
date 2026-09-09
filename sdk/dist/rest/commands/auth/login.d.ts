import { AuthenticationData, LDAPLoginPayload, LocalLoginPayload, LoginOptions } from "../../../auth/types.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/auth/login.d.ts

/**
 * Authenticate as a user.
 *
 * @param email Email address of the user.
 * @param password Password of the user.
 * @param options Optional login settings.
 *
 * @returns Authentication data.
 */
declare function login<Schema>(payload: LocalLoginPayload, options?: LoginOptions): RestCommand<AuthenticationData, Schema>;
declare function login<Schema>(payload: LDAPLoginPayload, options?: LoginOptions): RestCommand<AuthenticationData, Schema>;
//#endregion
export { login };
//# sourceMappingURL=login.d.ts.map