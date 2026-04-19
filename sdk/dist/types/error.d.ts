//#region src/types/error.d.ts
interface DirectusApiError {
  message: string;
  extensions: {
    code: string;
    [key: string]: any;
  };
}
interface DirectusError {
  message: string;
  errors: DirectusApiError[];
  response: Response;
  data?: any;
}
//#endregion
export { DirectusApiError, DirectusError };
//# sourceMappingURL=error.d.ts.map