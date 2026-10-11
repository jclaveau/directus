import { RequestTransformer } from "../../types/request.cjs";
import { RestCommand } from "../types.cjs";

//#region src/rest/helpers/with-options.d.ts

/**
 * Add arbitrary options to a fetch request
 *
 * @param getOptions
 * @param onRequest
 *
 * @returns
 */
declare function withOptions<Schema, Output>(getOptions: RestCommand<Output, Schema>, extraOptions: RequestTransformer | Partial<RequestInit>): RestCommand<Output, Schema>;
//#endregion
export { withOptions };
//# sourceMappingURL=with-options.d.cts.map