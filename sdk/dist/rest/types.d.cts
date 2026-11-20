import { RequestOptions, RequestTransformer, ResponseTransformer } from "../types/request.cjs";

//#region src/rest/types.d.ts
interface RestCommand<_Output extends object | unknown, _Schema> {
  (): RequestOptions;
}
interface RestClient<Schema> {
  request<Output>(options: RestCommand<Output, Schema>): Promise<Output>;
}
interface RestConfig {
  credentials?: RequestCredentials;
  onRequest?: RequestTransformer;
  onResponse?: ResponseTransformer;
}
//#endregion
export { RestClient, RestCommand, RestConfig };
//# sourceMappingURL=types.d.cts.map