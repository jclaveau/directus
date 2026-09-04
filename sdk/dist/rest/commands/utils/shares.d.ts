import { AuthenticationData, AuthenticationMode } from "../../../auth/types.js";
import { RestCommand } from "../../types.js";

//#region src/rest/commands/utils/shares.d.ts

/**
 * Authenticate as a share user.
 *
 * @param share The ID of the share.
 * @param password Password for the share, if one is configured.
 * @param mode Whether to retrieve the refresh token in the JSON response, or in a httpOnly cookie. One of `json`, `cookie` or `session`. Defaults to `cookie`.
 *
 * @returns Authentication data.
 */
declare const authenticateShare: <Schema>(share: string, password?: string, mode?: AuthenticationMode) => RestCommand<AuthenticationData, Schema>;
/**
 * Sends an email to the provided email addresses with a link to the share.
 *
 * @param share Primary key of the share you're inviting people to.
 * @param emails Array of email strings to send the share link to.
 *
 * @returns Nothing
 */
declare const inviteShare: <Schema>(share: string, emails: string[]) => RestCommand<void, Schema>;
/**
 * Allows unauthenticated users to retrieve information about the share.
 *
 * @param id Primary key of the share you're viewing.
 *
 * @returns The share objects for the given UUID, if it's still valid.
 */
declare const readShareInfo: <Schema>(id: string) => RestCommand<{
  id: string;
  collection: string;
  item: string;
  password: string | null;
  date_start: string | null;
  date_end: string | null;
  times_used: number | null;
  max_uses: number | null;
}, Schema>;
//#endregion
export { authenticateShare, inviteShare, readShareInfo };
//# sourceMappingURL=shares.d.ts.map