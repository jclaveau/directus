import { RestCommand } from "../types.cjs";

//#region src/rest/helpers/with-token.d.ts
declare function withToken<Schema, Output>(token: string, getOptions: RestCommand<Output, Schema>): RestCommand<Output, Schema>;
//#endregion
export { withToken };
//# sourceMappingURL=with-token.d.cts.map