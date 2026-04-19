//#region src/types/error.d.ts
interface DirectusApiError {
  message: string;
  extensions: {
    code: string;
    [key: string]: any;
  };
}
interface DirectusError<R = Response> {
  message: string;
  errors: DirectusApiError[];
  response: R;
  data?: any;
}
//#endregion
export { DirectusApiError, DirectusError };
//# sourceMappingURL=error.d.ts.map