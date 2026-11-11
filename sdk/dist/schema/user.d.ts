import { DirectusFile } from "./file.js";
import { DirectusRole } from "./role.js";
import { DirectusPolicy } from "./policy.js";
import { MergeCoreCollection } from "../types/schema.js";

//#region src/schema/user.d.ts

/**
 * directus_users type
 */
type DirectusUser<Schema = any> = MergeCoreCollection<Schema, 'directus_users', {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  password: string | null;
  location: string | null;
  title: string | null;
  description: string | null;
  tags: string[] | null;
  avatar: DirectusFile<Schema> | string | null;
  language: string | null;
  theme: string | null;
  tfa_secret: string | null;
  status: string;
  role: DirectusRole<Schema> | string | null;
  token: string | null;
  last_access: 'datetime' | null;
  last_page: string | null;
  provider: string;
  external_identifier: string | null;
  auth_data: Record<string, any> | null;
  email_notifications: boolean | null;
  appearance: string | null;
  theme_dark: string | null;
  theme_light: string | null;
  theme_light_overrides: Record<string, unknown> | null;
  theme_dark_overrides: Record<string, unknown> | null;
  policies: string[] | DirectusPolicy<Schema>[];
}>;
//#endregion
export { DirectusUser };
//# sourceMappingURL=user.d.ts.map