import { RequestOptions } from "../../types/request.cjs";
import { RestCommand } from "../types.cjs";

//#region src/rest/helpers/custom-endpoint.d.ts
declare function customEndpoint<Output = unknown>(options: RequestOptions): RestCommand<Output, never>;
//#endregion
export { customEndpoint };
//# sourceMappingURL=custom-endpoint.d.cts.map