//#region src/auth/types.d.ts
type AuthenticationMode = 'json' | 'cookie' | 'session';
type LocalLoginPayload = {
  email: string;
  password: string;
};
type LDAPLoginPayload = {
  identifier: string;
  password: string;
};
type LoginPayload = LocalLoginPayload | LDAPLoginPayload;
type LoginOptions = {
  /** The user's one-time-password (if MFA is enabled). */
  otp?: string;
  /** Whether to retrieve the refresh token in the JSON response, or in a httpOnly cookie. One of `json`, `cookie` or `session`. Defaults to `cookie`. */
  mode?: AuthenticationMode;
  /** Use a specific authentication provider (does not work for SSO that relies on browser redirects). */
  provider?: string;
};
type LogoutOptions = {
  refresh_token?: string;
  mode?: AuthenticationMode;
};
type RefreshOptions = {
  refresh_token?: string;
  mode?: AuthenticationMode;
};
interface AuthenticationData {
  access_token: string | null;
  refresh_token: string | null;
  expires: number | null;
  expires_at: number | null;
}
interface AuthenticationStorage {
  get: () => Promise<AuthenticationData | null> | AuthenticationData | null;
  set: (value: AuthenticationData | null) => Promise<unknown> | unknown;
}
interface AuthenticationConfig {
  autoRefresh: boolean;
  msRefreshBeforeExpires: number;
  credentials?: RequestCredentials;
  storage?: AuthenticationStorage;
}
interface AuthenticationClient<_Schema> {
  login(payload: LocalLoginPayload, options?: LoginOptions): Promise<AuthenticationData>;
  login(payload: LDAPLoginPayload, options?: LoginOptions): Promise<AuthenticationData>;
  refresh(options?: RefreshOptions): Promise<AuthenticationData>;
  logout(options?: LogoutOptions): Promise<void>;
  stopRefreshing(): void;
  getToken(): Promise<string | null>;
  setToken(access_token: string | null): Promise<unknown>;
}
interface StaticTokenClient<_Schema> {
  getToken(): Promise<string | null>;
  setToken(access_token: string | null): Promise<unknown>;
}
//#endregion
export { AuthenticationClient, AuthenticationConfig, AuthenticationData, AuthenticationMode, AuthenticationStorage, LDAPLoginPayload, LocalLoginPayload, LoginOptions, LoginPayload, LogoutOptions, RefreshOptions, StaticTokenClient };
//# sourceMappingURL=types.d.ts.map