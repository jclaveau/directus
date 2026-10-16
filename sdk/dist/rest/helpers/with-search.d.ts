import { RestCommand } from "../types.js";

//#region src/rest/helpers/with-search.d.ts
declare function withSearch<Schema, Output>(getOptions: RestCommand<Output, Schema>): RestCommand<Output, Schema>;
//#endregion
export { withSearch };
//# sourceMappingURL=with-search.d.ts.map