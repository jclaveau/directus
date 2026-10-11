import { RestCommand } from "../../types.js";

//#region src/rest/commands/auth/password-reset.d.ts

/**
 * The request a password reset endpoint sends an email with a link to the admin app (or a custom route) which in turn uses this endpoint to allow the user to reset their password.
 *
 * @param token Password reset token, as provided in the email sent by the request endpoint.
 * @param password New password for the user.
 *
 * @returns Empty body.
 */
declare const passwordReset: <Schema>(token: string, password: string) => RestCommand<void, Schema>;
//#endregion
export { passwordReset };
//# sourceMappingURL=password-reset.d.ts.map