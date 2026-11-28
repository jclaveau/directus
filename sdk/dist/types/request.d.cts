//#region src/types/request.d.ts
type HttpMethod = 'GET' | 'SEARCH' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
interface RequestOptions {
  path: string;
  method?: HttpMethod;
  params?: Record<string, any>;
  headers?: Record<string, string>;
  body?: string | FormData;
  onRequest?: RequestTransformer;
  onResponse?: ResponseTransformer;
}
type RequestTransformer = (options: RequestInit) => RequestInit | Promise<RequestInit>;
type ResponseTransformer<Output = any> = (data: any, request: RequestInit) => Output | Promise<Output>;
//#endregion
export { HttpMethod, RequestOptions, RequestTransformer, ResponseTransformer };
//# sourceMappingURL=request.d.cts.map