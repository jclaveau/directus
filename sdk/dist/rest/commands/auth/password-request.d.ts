import { RestCommand } from "../../types.js";

//#region src/rest/commands/auth/password-request.d.ts

/**
 * Request a password reset email to be sent to the given user.
 *
 * @param email Email address of the user you're requesting a password reset for.
 * @param reset_url Provide a custom reset url which the link in the email will lead to. The reset token will be passed as a parameter.
 *
 * @returns Empty body.
 */
declare const passwordRequest: <Schema>(email: string, reset_url?: string) => RestCommand<void, Schema>;
//#endregion
export { passwordRequest };
//# sourceMappingURL=password-request.d.ts.map