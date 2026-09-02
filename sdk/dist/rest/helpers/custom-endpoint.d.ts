import { RequestOptions } from "../../types/request.js";
import { RestCommand } from "../types.js";

//#region src/rest/helpers/custom-endpoint.d.ts
declare function customEndpoint<Output = unknown>(options: RequestOptions): RestCommand<Output, never>;
//#endregion
export { customEndpoint };
//# sourceMappingURL=custom-endpoint.d.ts.map