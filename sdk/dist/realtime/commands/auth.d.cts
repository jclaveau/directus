//#region src/realtime/commands/auth.d.ts
interface EmailAuth {
  email: string;
  password: string;
  uid?: string;
}
interface TokenAuth {
  access_token: string;
  uid?: string;
}
interface RefreshAuth {
  refresh_token: string;
  uid?: string;
}
declare function auth(creds: EmailAuth | TokenAuth | RefreshAuth): string;
//#endregion
export { EmailAuth, RefreshAuth, TokenAuth, auth };
//# sourceMappingURL=auth.d.cts.map